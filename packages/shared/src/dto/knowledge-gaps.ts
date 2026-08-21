import { z } from 'zod';

/**
 * Knowledge Gaps V1 DTOs.
 *
 * A "gap signal" is recorded when the existing retrieval pipeline could not
 * adequately support a question. Two deterministic reasons are tracked
 * independently so they can be measured separately:
 *   - no_relevant_knowledge: nothing survived the relevance threshold
 *   - weak_evidence:         something matched, but below the adequacy bar
 */
export const GapStatus = z.enum(['open', 'resolved', 'ignored']);
export type GapStatus = z.infer<typeof GapStatus>;

export const GapReason = z.enum(['no_relevant_knowledge', 'weak_evidence']);
export type GapReason = z.infer<typeof GapReason>;

export const GapRetrievalOutcome = z.enum(['no_results', 'weak']);
export type GapRetrievalOutcome = z.infer<typeof GapRetrievalOutcome>;

/** A near-miss document that almost matched (kept for weak_evidence signals). */
export interface GapWeakMatch {
  documentName: string;
  score: number;
  pageNumber: number | null;
}

/** Row in the admin Knowledge Gaps list. */
export interface KnowledgeGapSummary {
  id: string;
  title: string;
  status: GapStatus;
  occurrenceCount: number;
  distinctUsers: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** One recorded question behind a gap (admin-facing sample). */
export interface KnowledgeGapSignal {
  id: string;
  question: string;
  standaloneQuestion: string;
  reason: GapReason;
  retrievalOutcome: GapRetrievalOutcome;
  topScore: number | null;
  weakMatches: GapWeakMatch[];
  createdAt: string;
}

export interface KnowledgeGapDetail extends KnowledgeGapSummary {
  resolvedAt: string | null;
  reasonBreakdown: { no_relevant_knowledge: number; weak_evidence: number };
  signals: KnowledgeGapSignal[];
}

/** Admin action: resolve / ignore / reopen. */
export const UpdateGapRequest = z.object({
  status: GapStatus,
});
export type UpdateGapRequest = z.infer<typeof UpdateGapRequest>;

/** Org-scoped measurement for the dashboard header. */
export interface KnowledgeGapMetrics {
  totalQuestions: number;
  answeredFromKb: number;
  gapSignals: number;
  gapSignalRate: number; // 0..1
  signalsByReason: { no_relevant_knowledge: number; weak_evidence: number };
  recurringGaps: number; // gaps with 2+ occurrences
  openGaps: number;
  resolvedGaps: number;
  ignoredGaps: number;
}
