import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { QUEUE, type ExpectedDocument, type RagEvalJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { KnowledgeGapsService, type GapEvidence } from '../knowledge-gaps/knowledge-gaps.service.js';
import { aggregate, bestExpectedRank, toDocRanking, type CaseOutcome } from './eval-metrics.util.js';

const EVAL_TOP_K = 8; // matches the production chat default

/**
 * Executes eval runs off the HTTP thread, IN the API process, so it reuses the
 * exact production RetrievalService + KnowledgeGapsService (which live here). It
 * never reimplements retrieval — a change to retrieval automatically changes eval.
 */
@Injectable()
export class EvalRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvalRunnerService.name);
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly config: AppConfigService,
    private readonly database: DatabaseService,
    private readonly retrieval: RetrievalService,
    private readonly gaps: KnowledgeGapsService,
  ) {}

  onModuleInit(): void {
    this.connection = new IORedis(this.config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      QUEUE.Eval,
      async (job) => {
        await this.processRun(job.data as RagEvalJobV1);
      },
      { connection: this.connection, prefix: this.config.env.QUEUE_PREFIX, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      const runId = (job?.data as RagEvalJobV1 | undefined)?.runId;
      this.logger.error({ runId, err: err.message }, 'eval run job failed');
      if (runId) void this.markFailed(job!.data as RagEvalJobV1, err.message);
    });
    this.logger.log('eval runner listening');
  }

  /** Public seam: bind the tenant and run. Called by the worker and by tests. */
  async processRun(payload: RagEvalJobV1): Promise<void> {
    await this.database.runWithTenant(payload.organizationId, () => this.execute(payload));
  }

  private async execute(payload: RagEvalJobV1): Promise<void> {
    await this.database.db
      .updateTable('rag_eval_runs')
      .set({ status: 'running', started_at: new Date() })
      .where('id', '=', payload.runId)
      .execute();

    const cases = await this.database.db
      .selectFrom('rag_eval_cases')
      .select(['id', 'question', 'expected_answerable as expectedAnswerable', 'expected_gap as expectedGap'])
      .where('organization_id', '=', payload.organizationId)
      .where('dataset_id', '=', payload.datasetId)
      .execute();

    const expectedByCase = await this.expectedDocs(payload.organizationId, cases.map((c) => c.id));

    const outcomes: CaseOutcome[] = [];
    let errored = 0;
    for (const c of cases) {
      const expected = expectedByCase.get(c.id) ?? [];
      try {
        const outcome = await this.evaluateCase(payload, c, expected);
        outcomes.push(outcome);
      } catch (err) {
        errored += 1;
        outcomes.push(erroredOutcome(expected.length > 0, c.expectedAnswerable, c.expectedGap));
        await this.writeResult(payload, c, expected, { error: msg(err) });
      }
    }

    const summary = aggregate(outcomes);
    await this.database.db
      .updateTable('rag_eval_runs')
      .set({
        status: 'completed',
        completed_at: new Date(),
        succeeded_cases: cases.length - errored,
        errored_cases: errored,
        summary_metrics: JSON.stringify(summary),
      })
      .where('id', '=', payload.runId)
      .execute();

    this.logger.log({ runId: payload.runId, cases: cases.length, errored }, 'eval run complete');
  }

  /** Run ONE case through production retrieval + gap classification. */
  private async evaluateCase(
    payload: RagEvalJobV1,
    c: { id: string; question: string; expectedAnswerable: boolean; expectedGap: boolean },
    expected: ExpectedDocument[],
  ): Promise<CaseOutcome> {
    // Single question, no history -> no rewrite (matches production first turn).
    const detail = await this.retrieval.retrieveDetailed({
      organizationId: payload.organizationId,
      spaceId: payload.spaceId,
      question: c.question,
      topK: EVAL_TOP_K,
    });

    // Document-level ranking from the full pre-threshold reranked list.
    const docRanking = toDocRanking(detail.ranked);
    const expectedIds = new Set(expected.map((e) => e.documentId));
    const bestRank = bestExpectedRank(docRanking, expectedIds);
    const found = expected.length > 0 ? bestRank != null : null;

    // Answerability + gap use the REAL post-threshold survivors + production classifier.
    const evidence: GapEvidence[] = detail.survivors.map((s) => ({
      documentName: s.documentName,
      score: s.score,
      pageNumber: s.pageNumber,
    }));
    const topScore = detail.survivors[0]?.score ?? null;
    const classification = this.gaps.classifyEvidence(evidence);
    const actualGap = classification != null;
    const actualAnswerable = !actualGap;

    await this.writeResult(payload, c, expected, {
      retrieval: {
        ranked: docRanking,
        survivorTopScore: topScore,
        survivorTopDoc: detail.survivors[0]?.documentName ?? null,
        hadSurvivors: detail.survivors.length > 0,
        minScore: this.config.env.RETRIEVAL_MIN_SCORE,
      },
      topScore,
      expectedDocumentFound: found,
      expectedDocumentBestRank: bestRank,
      actualAnswerable,
      actualGap,
      gapReason: classification?.reason ?? null,
    });

    return {
      errored: false,
      hasExpectedDocs: expected.length > 0,
      expectedDocFound: !!found,
      expectedDocBestRank: bestRank,
      expectedAnswerable: c.expectedAnswerable,
      actualAnswerable,
      expectedGap: c.expectedGap,
      actualGap,
      gapReason: classification?.reason ?? null,
    };
  }

  private async writeResult(
    payload: RagEvalJobV1,
    c: { id: string; question: string; expectedAnswerable: boolean; expectedGap: boolean },
    expected: ExpectedDocument[],
    fields: {
      retrieval?: Record<string, unknown>;
      topScore?: number | null;
      expectedDocumentFound?: boolean | null;
      expectedDocumentBestRank?: number | null;
      actualAnswerable?: boolean | null;
      actualGap?: boolean | null;
      gapReason?: string | null;
      error?: string;
    },
  ): Promise<void> {
    await this.database.db
      .insertInto('rag_eval_results')
      .values({
        organization_id: payload.organizationId,
        run_id: payload.runId,
        eval_case_id: c.id,
        question: c.question,
        expected_answerable: c.expectedAnswerable,
        expected_gap: c.expectedGap,
        expected_documents: JSON.stringify(expected),
        retrieval: JSON.stringify(fields.retrieval ?? {}),
        top_score: fields.topScore ?? null,
        expected_document_found: fields.expectedDocumentFound ?? null,
        expected_document_best_rank: fields.expectedDocumentBestRank ?? null,
        actual_answerable: fields.actualAnswerable ?? null,
        actual_gap: fields.actualGap ?? null,
        gap_reason: fields.gapReason ?? null,
        error: fields.error ?? null,
      })
      .execute();
  }

  private async expectedDocs(org: string, caseIds: string[]): Promise<Map<string, ExpectedDocument[]>> {
    const map = new Map<string, ExpectedDocument[]>();
    if (caseIds.length === 0) return map;
    const rows = await this.database.db
      .selectFrom('rag_eval_case_expected_documents as x')
      .innerJoin('documents as d', 'd.id', 'x.document_id')
      .select(['x.eval_case_id as caseId', 'x.document_id as documentId', 'd.file_name as documentName', 'x.relevance as relevance'])
      .where('x.organization_id', '=', org)
      .where('x.eval_case_id', 'in', caseIds)
      .execute();
    for (const r of rows) {
      const list = map.get(r.caseId) ?? [];
      list.push({ documentId: r.documentId, documentName: r.documentName, relevance: r.relevance as 'primary' | 'acceptable' });
      map.set(r.caseId, list);
    }
    return map;
  }

  private async markFailed(payload: RagEvalJobV1, error: string): Promise<void> {
    await this.database
      .runWithTenant(payload.organizationId, () =>
        this.database.db
          .updateTable('rag_eval_runs')
          .set({ status: 'failed', error, completed_at: new Date() })
          .where('id', '=', payload.runId)
          .execute(),
      )
      .catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
  }
}

function erroredOutcome(hasExpectedDocs: boolean, expectedAnswerable: boolean, expectedGap: boolean): CaseOutcome {
  return {
    errored: true,
    hasExpectedDocs,
    expectedDocFound: false,
    expectedDocBestRank: null,
    expectedAnswerable,
    actualAnswerable: false,
    expectedGap,
    actualGap: false,
    gapReason: null,
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
