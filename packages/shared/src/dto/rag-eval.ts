import { z } from 'zod';

/**
 * RAG Evaluation V1 DTOs. An eval case is a labelled question ("expected
 * behaviour"); a run executes a dataset through the SAME production retrieval path
 * and scores the outcomes. No exact-answer matching in V1 — the labels are
 * retrieval/evidence expectations.
 */

export const EvalRelevance = z.enum(['primary', 'acceptable']);
export type EvalRelevance = z.infer<typeof EvalRelevance>;

export const EvalRunStatus = z.enum(['queued', 'running', 'completed', 'failed']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

// ---- requests ----

export const CreateDatasetRequest = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
});
export type CreateDatasetRequest = z.infer<typeof CreateDatasetRequest>;

export const ExpectedDocumentInput = z.object({
  documentId: z.string().uuid(),
  relevance: EvalRelevance.default('primary'),
});
export type ExpectedDocumentInput = z.infer<typeof ExpectedDocumentInput>;

export const UpsertCaseRequest = z.object({
  question: z.string().min(1).max(4000),
  expectedAnswerable: z.boolean(),
  expectedGap: z.boolean(),
  expectedDocuments: z.array(ExpectedDocumentInput).max(20).default([]),
  notes: z.string().max(2000).optional(),
});
export type UpsertCaseRequest = z.infer<typeof UpsertCaseRequest>;

/** Simulate candidate KNOWLEDGE_GAPS_ADEQUACY_SCORE values against a run's stored scores. */
export const SimulateThresholdsRequest = z.object({
  adequacyScores: z.array(z.number().min(0).max(1)).min(1).max(20),
});
export type SimulateThresholdsRequest = z.infer<typeof SimulateThresholdsRequest>;

/** Promote a real question (e.g. from a Knowledge Gap) into an eval dataset. */
export const AddToDatasetRequest = z.object({
  datasetId: z.string().uuid(),
  question: z.string().min(1).max(4000),
  expectedAnswerable: z.boolean(),
  expectedGap: z.boolean(),
  expectedDocuments: z.array(ExpectedDocumentInput).max(20).default([]),
  notes: z.string().max(2000).optional(),
});
export type AddToDatasetRequest = z.infer<typeof AddToDatasetRequest>;

// ---- responses ----

export interface ExpectedDocument {
  documentId: string;
  documentName: string;
  relevance: EvalRelevance;
}

export interface EvalDatasetSummary {
  id: string;
  name: string;
  description: string | null;
  caseCount: number;
  lastRunAt: string | null;
  lastRunStatus: EvalRunStatus | null;
  createdAt: string;
}

export interface EvalCase {
  id: string;
  question: string;
  expectedAnswerable: boolean;
  expectedGap: boolean;
  notes: string | null;
  expectedDocuments: ExpectedDocument[];
  createdAt: string;
}

export interface ConfusionMatrix {
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  accuracy: number;
}

export interface RetrievalMetrics {
  casesWithExpectedDocs: number;
  expectedDocHitRate: number; // 0..1
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number;
}

export interface GapMetrics {
  expectedGaps: number;
  detectedGaps: number;
  confusion: ConfusionMatrix;
  falsePositiveRate: number;
  falseNegativeRate: number;
  byReason: { no_relevant_knowledge: number; weak_evidence: number };
}

export interface EvalMetrics {
  totalCases: number;
  evaluatedCases: number;
  erroredCases: number;
  retrieval: RetrievalMetrics;
  answerability: ConfusionMatrix;
  gap: GapMetrics;
}

export interface EvalRunSummary {
  id: string;
  datasetId: string;
  status: EvalRunStatus;
  totalCases: number;
  succeededCases: number;
  erroredCases: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
  configSnapshot: Record<string, unknown>;
  summaryMetrics: EvalMetrics | null;
}

/** A preserved reranked candidate (document-level fields kept for debugging). */
export interface EvalRankedDoc {
  documentId: string;
  documentName: string;
  rerankScore: number;
  vectorScore: number;
  keywordScore: number;
  combinedScore: number;
  rank: number;
}

export interface EvalResult {
  id: string;
  question: string;
  expectedAnswerable: boolean;
  expectedGap: boolean;
  expectedDocuments: ExpectedDocument[];
  topScore: number | null;
  expectedDocumentFound: boolean | null;
  expectedDocumentBestRank: number | null;
  actualAnswerable: boolean | null;
  actualGap: boolean | null;
  gapReason: string | null;
  error: string | null;
  ranked: EvalRankedDoc[];
  survivorTopDoc: string | null;
}

export interface EvalRunDetail {
  run: EvalRunSummary;
  results: EvalResult[];
}

export interface ThresholdSimRow {
  adequacyScore: number;
  gap: GapMetrics;
  answerability: ConfusionMatrix;
}
