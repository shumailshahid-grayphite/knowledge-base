import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser, EmbeddingProvider, RagEvalJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { SpacesService } from '../spaces/spaces.service.js';
import { KnowledgeGapsService } from '../knowledge-gaps/knowledge-gaps.service.js';
import { ROLES_KEY } from '../common/roles.decorator.js';
import type { RetrievalDetail, RetrievedChunk, RankedCandidate, RetrievalService } from '../retrieval/retrieval.service.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationService } from './evaluation.service.js';
import { EvalRunnerService } from './eval-runner.service.js';
import type { EvalQueueService } from './eval-queue.service.js';
import { aggregate, bestExpectedRank, toDocRanking, type CaseOutcome } from './eval-metrics.util.js';

// ---- pure metric tests (no DB) ----

const outcome = (o: Partial<CaseOutcome>): CaseOutcome => ({
  errored: false,
  hasExpectedDocs: false,
  expectedDocFound: false,
  expectedDocBestRank: null,
  expectedAnswerable: true,
  actualAnswerable: true,
  expectedGap: false,
  actualGap: false,
  gapReason: null,
  ...o,
});

describe('eval metrics', () => {
  it('computes Recall@K and MRR from expected-doc ranks', () => {
    const m = aggregate([
      outcome({ hasExpectedDocs: true, expectedDocFound: true, expectedDocBestRank: 1 }),
      outcome({ hasExpectedDocs: true, expectedDocFound: true, expectedDocBestRank: 2 }),
      outcome({ hasExpectedDocs: true, expectedDocFound: true, expectedDocBestRank: 4 }),
      outcome({ hasExpectedDocs: true, expectedDocFound: false, expectedDocBestRank: null }),
    ]).retrieval;
    expect(m.casesWithExpectedDocs).toBe(4);
    expect(m.expectedDocHitRate).toBe(0.75);
    expect(m.recallAt1).toBe(0.25);
    expect(m.recallAt3).toBe(0.5);
    expect(m.recallAt5).toBe(0.75);
    expect(m.mrr).toBeCloseTo((1 + 0.5 + 0.25 + 0) / 4, 5); // 0.4375
  });

  it('computes the answerability confusion matrix with raw counts', () => {
    const a = aggregate([
      outcome({ expectedAnswerable: true, actualAnswerable: true }), // TP
      outcome({ expectedAnswerable: true, actualAnswerable: false }), // FN
      outcome({ expectedAnswerable: false, actualAnswerable: true }), // FP
      outcome({ expectedAnswerable: false, actualAnswerable: false }), // TN
    ]).answerability;
    expect([a.truePositive, a.falseNegative, a.falsePositive, a.trueNegative]).toEqual([1, 1, 1, 1]);
    expect(a.precision).toBe(0.5);
    expect(a.recall).toBe(0.5);
    expect(a.accuracy).toBe(0.5);
  });

  it('computes gap precision/recall/FPR/FNR + reason counts', () => {
    const g = aggregate([
      outcome({ expectedGap: true, actualGap: true, gapReason: 'no_relevant_knowledge' }), // TP
      outcome({ expectedGap: true, actualGap: true, gapReason: 'weak_evidence' }), // TP
      outcome({ expectedGap: true, actualGap: false }), // FN
      outcome({ expectedGap: false, actualGap: true, gapReason: 'weak_evidence' }), // FP
      outcome({ expectedGap: false, actualGap: false }), // TN
    ]).gap;
    expect(g.expectedGaps).toBe(3);
    expect(g.detectedGaps).toBe(3);
    expect(g.confusion.precision).toBeCloseTo(2 / 3, 5);
    expect(g.confusion.recall).toBeCloseTo(2 / 3, 5);
    expect(g.falsePositiveRate).toBeCloseTo(1 / 2, 5); // FP / (FP+TN)
    expect(g.falseNegativeRate).toBeCloseTo(1 / 3, 5); // FN / (FN+TP)
    expect(g.byReason).toEqual({ no_relevant_knowledge: 1, weak_evidence: 2 });
  });

  it('excludes errored cases from all metrics', () => {
    const m = aggregate([
      outcome({ errored: true, hasExpectedDocs: true }),
      outcome({ expectedAnswerable: true, actualAnswerable: true }),
    ]);
    expect(m.totalCases).toBe(2);
    expect(m.evaluatedCases).toBe(1);
    expect(m.erroredCases).toBe(1);
    expect(m.retrieval.casesWithExpectedDocs).toBe(0);
  });

  it('ranks documents (best occurrence) and finds expected ranks', () => {
    const ranked = toDocRanking([
      { documentId: 'A', documentName: 'A', rerankScore: 0.9, vectorScore: 0, keywordScore: 0, combinedScore: 0 },
      { documentId: 'A', documentName: 'A', rerankScore: 0.7, vectorScore: 0, keywordScore: 0, combinedScore: 0 },
      { documentId: 'B', documentName: 'B', rerankScore: 0.6, vectorScore: 0, keywordScore: 0, combinedScore: 0 },
    ]);
    expect(ranked.map((d) => [d.documentId, d.rank])).toEqual([['A', 1], ['B', 2]]);
    expect(bestExpectedRank(ranked, new Set(['B']))).toBe(2);
    expect(bestExpectedRank(ranked, new Set(['C']))).toBeNull();
    expect(bestExpectedRank(ranked, new Set(['B', 'A']))).toBe(1); // multiple acceptable -> best
  });
});

describe('EvaluationController authorization', () => {
  it('is gated to owner/admin via @Roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, EvaluationController)).toEqual(['owner', 'admin']);
  });
});

// ---- integration (local Postgres) ----

const HAS_DB = !!(process.env.APP_DATABASE_URL || process.env.DATABASE_URL);
const TAG = 'EVALTEST';
const ORG_A = '00000000-0000-0000-0000-000000000001';
const USER_A = '00000000-0000-0000-0000-000000000002';
const SPACE_A = '00000000-0000-0000-0000-000000000003';
const ORG_B = '33333333-3333-3333-3333-333333333b00';
const USER_B = '33333333-3333-3333-3333-333333333b01';

const stubEmbedder: EmbeddingProvider = {
  model: 'stub',
  dimension: 1536,
  async embedOne() { return new Array(1536).fill(0); },
  async embed(t) { return t.map(() => new Array(1536).fill(0)); },
};

const user = (id: string, org: string, role: AuthUser['role']): AuthUser => ({ id, email: `${id}@t`, name: null, organizationId: org, role });

function chunk(documentId: string, documentName: string, score: number): RetrievedChunk {
  return {
    chunkId: `${documentId}-c`, content: 'x', pageNumber: null, chunkIndex: 0, documentId, documentName,
    sourceUrl: null, contentHash: null, vectorScore: score, keywordScore: 0, combinedScore: score, rerankScore: score, rank: 1, score,
  };
}
function ranked(documentId: string, documentName: string, score: number, rank: number): RankedCandidate {
  return { chunkId: `${documentId}-c`, documentId, documentName, pageNumber: null, vectorScore: score, keywordScore: 0, combinedScore: score, rerankScore: score, rank };
}

describe.skipIf(!HAS_DB)('RAG Evaluation (integration)', () => {
  let db: DatabaseService;
  let service: EvaluationService;
  let runner: EvalRunnerService;
  let gaps: KnowledgeGapsService;
  let docHandbook: string;
  let docExpense: string;
  const created: { datasets: string[] } = { datasets: [] };

  const adminA = user(USER_A, ORG_A, 'owner');
  const adminB = user(USER_B, ORG_B, 'owner');
  const asA = <T>(fn: () => Promise<T>) => db.runWithTenant(ORG_A, fn);
  const asB = <T>(fn: () => Promise<T>) => db.runWithTenant(ORG_B, fn);

  // Canned production-retrieval output, keyed by question.
  const canned: Record<string, RetrievalDetail> = {};
  const retrievalStub = {
    async retrieveDetailed(p: { question: string }): Promise<RetrievalDetail> {
      if (p.question.includes('THROW')) throw new Error('boom');
      return canned[p.question] ?? { survivors: [], ranked: [] };
    },
  } as unknown as RetrievalService;

  beforeAll(async () => {
    const cfg = new AppConfigService();
    db = new DatabaseService(cfg);
    gaps = new KnowledgeGapsService(db, cfg, stubEmbedder);
    const queueStub = { enqueue: async () => 'x' } as unknown as EvalQueueService;
    service = new EvaluationService(db, cfg, new SpacesService(db, cfg), gaps, queueStub);
    runner = new EvalRunnerService(cfg, db, retrievalStub, gaps);

    await asA(async () => {
      const h = await db.db.insertInto('documents').values({ organization_id: ORG_A, knowledge_base_id: SPACE_A, file_name: `${TAG} Employee Handbook`, status: 'completed' }).returning('id').executeTakeFirstOrThrow();
      docHandbook = h.id;
      const e = await db.db.insertInto('documents').values({ organization_id: ORG_A, knowledge_base_id: SPACE_A, file_name: `${TAG} Expense Policy`, status: 'completed' }).returning('id').executeTakeFirstOrThrow();
      docExpense = e.id;
    });

    // org B (isolation)
    await db.db.insertInto('organizations').values({ id: ORG_B, name: 'Eval B', slug: `evalb-${TAG.toLowerCase()}` }).onConflict((o) => o.doNothing()).execute();
    await db.db.insertInto('users').values({ id: USER_B, email: `${USER_B}@t`, name: 'B', password_hash: 'x' }).onConflict((o) => o.doNothing()).execute();
    await db.db.insertInto('memberships').values({ organization_id: ORG_B, user_id: USER_B, role: 'owner' }).onConflict((o) => o.doNothing()).execute();
  });

  afterAll(async () => {
    if (!db) return;
    await asA(async () => {
      for (const d of created.datasets) await db.db.deleteFrom('rag_eval_datasets').where('id', '=', d).execute();
      await db.db.deleteFrom('documents').where('organization_id', '=', ORG_A).where('file_name', 'like', `${TAG}%`).execute();
    });
    await db.db.deleteFrom('memberships').where('user_id', '=', USER_B).execute();
    await db.db.deleteFrom('organizations').where('id', '=', ORG_B).execute();
    await db.db.deleteFrom('users').where('id', '=', USER_B).execute();
    await db.onModuleDestroy();
  });

  async function newDataset(): Promise<string> {
    const ds = await asA(() => service.createDataset(adminA, { name: `${TAG} ${created.datasets.length}` }));
    created.datasets.push(ds.id);
    return ds.id;
  }

  it('CRUDs cases with expected documents (primary + acceptable)', async () => {
    const ds = await newDataset();
    await asA(() => service.createCase(adminA, ds, {
      question: `${TAG} annual leave allowance?`,
      expectedAnswerable: true,
      expectedGap: false,
      expectedDocuments: [{ documentId: docHandbook, relevance: 'primary' }, { documentId: docExpense, relevance: 'acceptable' }],
    }));
    const detail = await asA(() => service.getDatasetCases(adminA, ds));
    expect(detail.cases).toHaveLength(1);
    expect(detail.cases[0]!.expectedDocuments.map((d) => d.relevance).sort()).toEqual(['acceptable', 'primary']);

    // update replaces expected docs
    const updated = await asA(() => service.updateCase(adminA, detail.cases[0]!.id, {
      question: detail.cases[0]!.question, expectedAnswerable: true, expectedGap: false,
      expectedDocuments: [{ documentId: docHandbook, relevance: 'primary' }],
    }));
    expect(updated.expectedDocuments).toHaveLength(1);
    await asA(() => service.deleteCase(adminA, detail.cases[0]!.id));
    expect((await asA(() => service.getDatasetCases(adminA, ds))).cases).toHaveLength(0);
  });

  it('runs a dataset through production retrieval and scores it', async () => {
    const ds = await newDataset();
    const mk = (q: string, ans: boolean, gap: boolean, docs: string[] = []) =>
      asA(() => service.createCase(adminA, ds, { question: q, expectedAnswerable: ans, expectedGap: gap, expectedDocuments: docs.map((d) => ({ documentId: d, relevance: 'primary' as const })) }));

    const q1 = `${TAG} leave policy`, q2 = `${TAG} parental leave`, q3 = `${TAG} kubernetes rollback`, q4 = `${TAG} near match`;
    await mk(q1, true, false, [docHandbook]);
    await mk(q2, true, false, [docHandbook]);
    await mk(q3, false, true);
    await mk(q4, false, true);

    canned[q1] = { survivors: [chunk(docHandbook, 'HB', 0.8)], ranked: [ranked(docHandbook, 'HB', 0.8, 1), ranked(docExpense, 'EX', 0.5, 2)] };
    canned[q2] = { survivors: [chunk(docExpense, 'EX', 0.6)], ranked: [ranked(docExpense, 'EX', 0.6, 1), ranked(docHandbook, 'HB', 0.5, 2)] }; // expected doc at rank 2
    canned[q3] = { survivors: [], ranked: [] }; // no evidence -> gap
    canned[q4] = { survivors: [chunk(docExpense, 'EX', 0.35)], ranked: [ranked(docExpense, 'EX', 0.35, 1)] }; // weak -> gap

    const runId = await asA(async () => {
      const r = await db.db.insertInto('rag_eval_runs').values({ organization_id: ORG_A, dataset_id: ds, status: 'queued', total_cases: 4 }).returning('id').executeTakeFirstOrThrow();
      return r.id;
    });
    const payload: RagEvalJobV1 = { contractVersion: 1, jobType: 'rag_eval_run', organizationId: ORG_A, datasetId: ds, runId, spaceId: SPACE_A };
    await runner.processRun(payload);

    const detail = await asA(() => service.getRun(adminA, runId));
    expect(detail.run.status).toBe('completed');
    const m = detail.run.summaryMetrics!;
    expect(m.retrieval.recallAt1).toBe(0.5); // q1 rank1 hit, q2 rank2 miss
    expect(m.retrieval.recallAt3).toBe(1);
    expect(m.retrieval.mrr).toBeCloseTo(0.75, 5);
    expect(m.answerability.accuracy).toBe(1);
    expect(m.gap.confusion.precision).toBe(1);
    expect(m.gap.confusion.recall).toBe(1);
    expect(m.gap.byReason).toEqual({ no_relevant_knowledge: 1, weak_evidence: 1 });
  });

  it('isolates one broken case without failing the run', async () => {
    const ds = await newDataset();
    await asA(() => service.createCase(adminA, ds, { question: `${TAG} good`, expectedAnswerable: true, expectedGap: false, expectedDocuments: [] }));
    await asA(() => service.createCase(adminA, ds, { question: `${TAG} THROW bad`, expectedAnswerable: true, expectedGap: false, expectedDocuments: [] }));
    canned[`${TAG} good`] = { survivors: [chunk(docHandbook, 'HB', 0.9)], ranked: [ranked(docHandbook, 'HB', 0.9, 1)] };

    const runId = await asA(async () => (await db.db.insertInto('rag_eval_runs').values({ organization_id: ORG_A, dataset_id: ds, status: 'queued', total_cases: 2 }).returning('id').executeTakeFirstOrThrow()).id);
    await runner.processRun({ contractVersion: 1, jobType: 'rag_eval_run', organizationId: ORG_A, datasetId: ds, runId, spaceId: SPACE_A });

    const detail = await asA(() => service.getRun(adminA, runId));
    expect(detail.run.status).toBe('completed');
    expect(detail.run.erroredCases).toBe(1);
    expect(detail.run.succeededCases).toBe(1);
    expect(detail.results.find((r) => r.question.includes('THROW'))!.error).toBeTruthy();
  });

  it('re-running creates a new run rather than overwriting history', async () => {
    const ds = await newDataset();
    await asA(() => service.createCase(adminA, ds, { question: `${TAG} q`, expectedAnswerable: true, expectedGap: false, expectedDocuments: [] }));
    const r1 = await asA(() => service.startRun(adminA, ds));
    const r2 = await asA(() => service.startRun(adminA, ds));
    expect(r1.id).not.toBe(r2.id);
    expect((await asA(() => service.listRuns(adminA, ds)))).toHaveLength(2);
  });

  it('simulates adequacy thresholds from preserved scores without mutating the run', async () => {
    const ds = await newDataset();
    const runId = await asA(async () => (await db.db.insertInto('rag_eval_runs').values({ organization_id: ORG_A, dataset_id: ds, status: 'completed', total_cases: 2 }).returning('id').executeTakeFirstOrThrow()).id);
    // r1: not a gap, top 0.45 ; r2: is a gap, top 0.43
    await asA(async () => {
      await db.db.insertInto('rag_eval_results').values({ organization_id: ORG_A, run_id: runId, question: 'r1', expected_answerable: true, expected_gap: false, retrieval: JSON.stringify({ hadSurvivors: true, survivorTopScore: 0.45 }), top_score: 0.45, actual_gap: false, actual_answerable: true }).execute();
      await db.db.insertInto('rag_eval_results').values({ organization_id: ORG_A, run_id: runId, question: 'r2', expected_answerable: false, expected_gap: true, retrieval: JSON.stringify({ hadSurvivors: true, survivorTopScore: 0.43 }), top_score: 0.43, actual_gap: false, actual_answerable: true }).execute();
    });

    const rows = await asA(() => service.simulateThresholds(adminA, runId, [0.3, 0.5]));
    const at = (s: number) => rows.find((r) => r.adequacyScore === s)!;
    // 0.3: neither is a gap -> r2 is a missed gap (recall 0)
    expect(at(0.3).gap.confusion.recall).toBe(0);
    expect(at(0.3).gap.detectedGaps).toBe(0);
    // 0.5: both below -> both gaps; r2 TP (recall 1), r1 FP (precision 0.5)
    expect(at(0.5).gap.confusion.recall).toBe(1);
    expect(at(0.5).gap.confusion.precision).toBe(0.5);

    // original results untouched
    const persisted = await asA(() => db.db.selectFrom('rag_eval_results').select(['actual_gap']).where('run_id', '=', runId).execute());
    expect(persisted.every((p) => p.actual_gap === false)).toBe(true);
  });

  it('isolates evaluation data across organizations (RLS)', async () => {
    const ds = await newDataset();
    // B sees none of A's datasets
    expect((await asB(() => service.listDatasets(adminB))).some((d) => d.id === ds)).toBe(false);
    // B cannot read A's dataset or its runs
    await expect(asB(() => service.getDatasetCases(adminB, ds))).rejects.toThrow();
    // raw RLS check
    const leaked = await asB(() => db.db.selectFrom('rag_eval_datasets').select('id').where('id', '=', ds).execute());
    expect(leaked).toHaveLength(0);
  });
});
