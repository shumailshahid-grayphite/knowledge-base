import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { resolveProviderConfig } from '@kb/providers';
import type {
  AuthUser,
  CreateDatasetRequest,
  EvalCase,
  EvalDatasetSummary,
  EvalMetrics,
  EvalRankedDoc,
  EvalResult,
  EvalRunDetail,
  EvalRunStatus,
  EvalRunSummary,
  ExpectedDocument,
  ThresholdSimRow,
  UpsertCaseRequest,
} from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { SpacesService } from '../spaces/spaces.service.js';
import { KnowledgeGapsService, type GapEvidence } from '../knowledge-gaps/knowledge-gaps.service.js';
import { EvalQueueService } from './eval-queue.service.js';
import { aggregate, type CaseOutcome } from './eval-metrics.util.js';

/**
 * RAG Evaluation V1 — CRUD for datasets/cases, run orchestration (enqueue only;
 * the in-API EvalRunner executes), and metric reads + threshold simulation. All
 * org-scoped; admin-only enforced at the controller via RolesGuard.
 */
@Injectable()
export class EvaluationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
    private readonly spaces: SpacesService,
    private readonly gaps: KnowledgeGapsService,
    private readonly queue: EvalQueueService,
  ) {}

  // ---- datasets ----

  async createDataset(user: AuthUser, body: CreateDatasetRequest) {
    const row = await this.database.db
      .insertInto('rag_eval_datasets')
      .values({
        organization_id: user.organizationId,
        name: body.name.trim(),
        description: body.description ?? null,
        created_by: user.id,
      })
      .returning(['id', 'name', 'description', 'created_at as createdAt'])
      .executeTakeFirstOrThrow();
    return { id: row.id, name: row.name, description: row.description, caseCount: 0, lastRunAt: null, lastRunStatus: null, createdAt: iso(row.createdAt) };
  }

  async listDatasets(user: AuthUser): Promise<EvalDatasetSummary[]> {
    const org = user.organizationId;
    const datasets = await this.database.db
      .selectFrom('rag_eval_datasets')
      .select(['id', 'name', 'description', 'created_at as createdAt'])
      .where('organization_id', '=', org)
      .orderBy('created_at', 'desc')
      .execute();
    if (datasets.length === 0) return [];

    const counts = await this.database.db
      .selectFrom('rag_eval_cases')
      .select(['dataset_id'])
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('organization_id', '=', org)
      .groupBy('dataset_id')
      .execute();
    const countBy = new Map(counts.map((c) => [c.dataset_id, Number(c.n)]));

    const runs = await this.database.db
      .selectFrom('rag_eval_runs')
      .select(['dataset_id', 'status', 'created_at as createdAt'])
      .distinctOn('dataset_id')
      .where('organization_id', '=', org)
      .orderBy('dataset_id')
      .orderBy('created_at', 'desc')
      .execute();
    const lastRunBy = new Map(runs.map((r) => [r.dataset_id, r]));

    return datasets.map((d) => {
      const lr = lastRunBy.get(d.id);
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        caseCount: countBy.get(d.id) ?? 0,
        lastRunAt: lr ? iso(lr.createdAt) : null,
        lastRunStatus: (lr?.status as EvalRunStatus) ?? null,
        createdAt: iso(d.createdAt),
      };
    });
  }

  async getDatasetCases(user: AuthUser, datasetId: string): Promise<{ id: string; name: string; description: string | null; cases: EvalCase[] }> {
    const ds = await this.requireDataset(user, datasetId);
    const cases = await this.database.db
      .selectFrom('rag_eval_cases')
      .select(['id', 'question', 'expected_answerable as expectedAnswerable', 'expected_gap as expectedGap', 'notes', 'created_at as createdAt'])
      .where('organization_id', '=', user.organizationId)
      .where('dataset_id', '=', datasetId)
      .orderBy('created_at', 'asc')
      .execute();

    const expected = await this.expectedDocsForCases(user.organizationId, cases.map((c) => c.id));
    return {
      id: ds.id,
      name: ds.name,
      description: ds.description,
      cases: cases.map((c) => ({
        id: c.id,
        question: c.question,
        expectedAnswerable: c.expectedAnswerable,
        expectedGap: c.expectedGap,
        notes: c.notes,
        expectedDocuments: expected.get(c.id) ?? [],
        createdAt: iso(c.createdAt),
      })),
    };
  }

  // ---- cases ----

  async createCase(user: AuthUser, datasetId: string, body: UpsertCaseRequest): Promise<EvalCase> {
    await this.requireDataset(user, datasetId);
    const c = await this.database.db
      .insertInto('rag_eval_cases')
      .values({
        organization_id: user.organizationId,
        dataset_id: datasetId,
        question: body.question.trim(),
        expected_answerable: body.expectedAnswerable,
        expected_gap: body.expectedGap,
        notes: body.notes ?? null,
        created_by: user.id,
      })
      .returning(['id', 'created_at as createdAt'])
      .executeTakeFirstOrThrow();
    await this.replaceExpectedDocs(user, c.id, body.expectedDocuments);
    return this.getCase(user, c.id);
  }

  async updateCase(user: AuthUser, caseId: string, body: UpsertCaseRequest): Promise<EvalCase> {
    const res = await this.database.db
      .updateTable('rag_eval_cases')
      .set({
        question: body.question.trim(),
        expected_answerable: body.expectedAnswerable,
        expected_gap: body.expectedGap,
        notes: body.notes ?? null,
      })
      .where('id', '=', caseId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!res.numUpdatedRows) throw new NotFoundException('Case not found');
    await this.replaceExpectedDocs(user, caseId, body.expectedDocuments);
    return this.getCase(user, caseId);
  }

  async deleteCase(user: AuthUser, caseId: string): Promise<{ id: string }> {
    const res = await this.database.db
      .deleteFrom('rag_eval_cases')
      .where('id', '=', caseId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!res.numDeletedRows) throw new NotFoundException('Case not found');
    return { id: caseId };
  }

  // ---- runs ----

  async startRun(user: AuthUser, datasetId: string): Promise<EvalRunSummary> {
    await this.requireDataset(user, datasetId);
    const count = await this.database.db
      .selectFrom('rag_eval_cases')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('organization_id', '=', user.organizationId)
      .where('dataset_id', '=', datasetId)
      .executeTakeFirst();
    const total = Number(count?.n ?? 0);
    if (total === 0) throw new BadRequestException('Dataset has no cases to run');

    const space = await this.spaces.getOrCreateDefault(user);
    const run = await this.database.db
      .insertInto('rag_eval_runs')
      .values({
        organization_id: user.organizationId,
        dataset_id: datasetId,
        status: 'queued',
        started_by: user.id,
        config_snapshot: JSON.stringify(this.buildConfigSnapshot()),
        total_cases: total,
      })
      .returning(['id', 'status', 'total_cases as totalCases', 'created_at as createdAt', 'config_snapshot as configSnapshot'])
      .executeTakeFirstOrThrow();

    await this.queue.enqueue({
      contractVersion: 1,
      jobType: 'rag_eval_run',
      organizationId: user.organizationId,
      datasetId,
      runId: run.id,
      spaceId: space.id,
    });

    return {
      id: run.id,
      datasetId,
      status: run.status as EvalRunStatus,
      totalCases: Number(run.totalCases),
      succeededCases: 0,
      erroredCases: 0,
      startedAt: null,
      completedAt: null,
      createdAt: iso(run.createdAt),
      error: null,
      configSnapshot: (run.configSnapshot ?? {}) as Record<string, unknown>,
      summaryMetrics: null,
    };
  }

  async listRuns(user: AuthUser, datasetId: string): Promise<EvalRunSummary[]> {
    const rows = await this.database.db
      .selectFrom('rag_eval_runs')
      .select([
        'id', 'dataset_id as datasetId', 'status', 'total_cases as totalCases',
        'succeeded_cases as succeededCases', 'errored_cases as erroredCases',
        'started_at as startedAt', 'completed_at as completedAt', 'created_at as createdAt', 'error',
        'config_snapshot as configSnapshot', 'summary_metrics as summaryMetrics',
      ])
      .where('organization_id', '=', user.organizationId)
      .where('dataset_id', '=', datasetId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => this.mapRun(r));
  }

  async getRun(user: AuthUser, runId: string): Promise<EvalRunDetail> {
    const run = await this.database.db
      .selectFrom('rag_eval_runs')
      .select([
        'id', 'dataset_id as datasetId', 'status', 'total_cases as totalCases',
        'succeeded_cases as succeededCases', 'errored_cases as erroredCases',
        'started_at as startedAt', 'completed_at as completedAt', 'created_at as createdAt', 'error',
        'config_snapshot as configSnapshot', 'summary_metrics as summaryMetrics',
      ])
      .where('id', '=', runId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!run) throw new NotFoundException('Run not found');

    const results = await this.database.db
      .selectFrom('rag_eval_results')
      .selectAll()
      .where('organization_id', '=', user.organizationId)
      .where('run_id', '=', runId)
      .orderBy('created_at', 'asc')
      .execute();

    return { run: this.mapRun(run), results: results.map((r) => mapResult(r)) };
  }

  /** Recompute gap + answerability confusion for candidate adequacy thresholds. */
  async simulateThresholds(user: AuthUser, runId: string, adequacyScores: number[]): Promise<ThresholdSimRow[]> {
    const run = await this.database.db
      .selectFrom('rag_eval_runs')
      .select('id')
      .where('id', '=', runId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!run) throw new NotFoundException('Run not found');

    const results = await this.database.db
      .selectFrom('rag_eval_results')
      .select(['expected_answerable as expectedAnswerable', 'expected_gap as expectedGap', 'error', 'retrieval', 'expected_documents as expectedDocuments', 'expected_document_found as found', 'expected_document_best_rank as bestRank'])
      .where('organization_id', '=', user.organizationId)
      .where('run_id', '=', runId)
      .execute();

    return adequacyScores.map((adequacy) => {
      const outcomes: CaseOutcome[] = results.map((r) => {
        const ret = (r.retrieval ?? {}) as { survivorTopScore?: number | null; hadSurvivors?: boolean };
        // Reconstruct minimal evidence and reuse the SAME production classifier.
        const evidence: GapEvidence[] = ret.hadSurvivors
          ? [{ documentName: '', score: ret.survivorTopScore ?? 0, pageNumber: null }]
          : [];
        const cls = this.gaps.classifyEvidence(evidence, adequacy);
        const actualGap = cls != null;
        return {
          errored: !!r.error,
          hasExpectedDocs: ((r.expectedDocuments ?? []) as unknown[]).length > 0,
          expectedDocFound: !!r.found,
          expectedDocBestRank: (r.bestRank as number | null) ?? null,
          expectedAnswerable: r.expectedAnswerable,
          actualAnswerable: !actualGap,
          expectedGap: r.expectedGap,
          actualGap,
          gapReason: cls?.reason ?? null,
        };
      });
      const m = aggregate(outcomes);
      return { adequacyScore: adequacy, gap: m.gap, answerability: m.answerability };
    });
  }

  /** Search the org's documents by name (for the expected-document picker). */
  async searchDocuments(user: AuthUser, q: string): Promise<{ documentId: string; documentName: string }[]> {
    let query = this.database.db
      .selectFrom('documents')
      .select(['id as documentId', 'file_name as documentName'])
      .where('organization_id', '=', user.organizationId)
      .orderBy('file_name', 'asc')
      .limit(20);
    const term = q.trim();
    if (term) query = query.where('file_name', 'ilike', `%${term}%`);
    return query.execute();
  }

  // ---- helpers ----

  buildConfigSnapshot(): Record<string, unknown> {
    const env = this.config.env;
    const p = resolveProviderConfig(process.env);
    return {
      retrieval: {
        candidatePool: env.RETRIEVAL_CANDIDATE_POOL,
        vectorWeight: env.RETRIEVAL_VECTOR_WEIGHT,
        keywordWeight: env.RETRIEVAL_KEYWORD_WEIGHT,
        maxPerDoc: env.RETRIEVAL_MAX_PER_DOC,
        highRelevance: env.RETRIEVAL_HIGH_RELEVANCE,
        rerankPool: env.RETRIEVAL_RERANK_POOL,
        minScore: env.RETRIEVAL_MIN_SCORE,
        tokenBudget: env.RETRIEVAL_TOKEN_BUDGET,
      },
      knowledgeGaps: {
        adequacyScore: env.KNOWLEDGE_GAPS_ADEQUACY_SCORE,
        similarity: env.KNOWLEDGE_GAPS_SIMILARITY,
      },
      providers: {
        mode: p.mode,
        embeddingModel: p.embeddingModel,
        llmModel: p.llmModel,
        rerankMode: p.rerankMode,
      },
    };
  }

  private async requireDataset(user: AuthUser, datasetId: string) {
    const ds = await this.database.db
      .selectFrom('rag_eval_datasets')
      .select(['id', 'name', 'description'])
      .where('id', '=', datasetId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!ds) throw new NotFoundException('Dataset not found');
    return ds;
  }

  private async getCase(user: AuthUser, caseId: string): Promise<EvalCase> {
    const c = await this.database.db
      .selectFrom('rag_eval_cases')
      .select(['id', 'question', 'expected_answerable as expectedAnswerable', 'expected_gap as expectedGap', 'notes', 'created_at as createdAt'])
      .where('id', '=', caseId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!c) throw new NotFoundException('Case not found');
    const docs = await this.expectedDocsForCases(user.organizationId, [caseId]);
    return {
      id: c.id,
      question: c.question,
      expectedAnswerable: c.expectedAnswerable,
      expectedGap: c.expectedGap,
      notes: c.notes,
      expectedDocuments: docs.get(caseId) ?? [],
      createdAt: iso(c.createdAt),
    };
  }

  private async replaceExpectedDocs(user: AuthUser, caseId: string, docs: { documentId: string; relevance: 'primary' | 'acceptable' }[]) {
    await this.database.db
      .deleteFrom('rag_eval_case_expected_documents')
      .where('eval_case_id', '=', caseId)
      .where('organization_id', '=', user.organizationId)
      .execute();
    if (docs.length === 0) return;
    // Validate the documents belong to this org (RLS also guards).
    const valid = await this.database.db
      .selectFrom('documents')
      .select('id')
      .where('organization_id', '=', user.organizationId)
      .where('id', 'in', docs.map((d) => d.documentId))
      .execute();
    const validIds = new Set(valid.map((v) => v.id));
    const rows = docs
      .filter((d) => validIds.has(d.documentId))
      .map((d) => ({ organization_id: user.organizationId, eval_case_id: caseId, document_id: d.documentId, relevance: d.relevance }));
    if (rows.length > 0) {
      await this.database.db.insertInto('rag_eval_case_expected_documents').values(rows).execute();
    }
  }

  private async expectedDocsForCases(org: string, caseIds: string[]): Promise<Map<string, ExpectedDocument[]>> {
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

  private mapRun(r: {
    id: string; datasetId: string; status: string; totalCases: number; succeededCases: number; erroredCases: number;
    startedAt: Date | null; completedAt: Date | null; createdAt: Date; error: string | null; configSnapshot: unknown; summaryMetrics: unknown;
  }): EvalRunSummary {
    const metrics = r.summaryMetrics && Object.keys(r.summaryMetrics as object).length > 0 ? (r.summaryMetrics as EvalMetrics) : null;
    return {
      id: r.id,
      datasetId: r.datasetId,
      status: r.status as EvalRunStatus,
      totalCases: Number(r.totalCases),
      succeededCases: Number(r.succeededCases),
      erroredCases: Number(r.erroredCases),
      startedAt: r.startedAt ? iso(r.startedAt) : null,
      completedAt: r.completedAt ? iso(r.completedAt) : null,
      createdAt: iso(r.createdAt),
      error: r.error ?? null,
      configSnapshot: (r.configSnapshot ?? {}) as Record<string, unknown>,
      summaryMetrics: metrics,
    };
  }
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** Map a persisted result row to the API shape (parses the preserved retrieval snapshot). */
function mapResult(r: {
  id: string; question: string; expected_answerable: boolean; expected_gap: boolean; expected_documents: unknown;
  top_score: number | null; expected_document_found: boolean | null; expected_document_best_rank: number | null;
  actual_answerable: boolean | null; actual_gap: boolean | null; gap_reason: string | null; error: string | null; retrieval: unknown;
}): EvalResult {
  const ret = (r.retrieval ?? {}) as { ranked?: EvalRankedDoc[]; survivorTopDoc?: string | null };
  return {
    id: r.id,
    question: r.question,
    expectedAnswerable: r.expected_answerable,
    expectedGap: r.expected_gap,
    expectedDocuments: (r.expected_documents ?? []) as ExpectedDocument[],
    topScore: r.top_score == null ? null : Number(r.top_score),
    expectedDocumentFound: r.expected_document_found,
    expectedDocumentBestRank: r.expected_document_best_rank,
    actualAnswerable: r.actual_answerable,
    actualGap: r.actual_gap,
    gapReason: r.gap_reason,
    error: r.error,
    ranked: (ret.ranked ?? []).slice(0, 10),
    survivorTopDoc: ret.survivorTopDoc ?? null,
  };
}
