import type { ConfusionMatrix, EvalMetrics, EvalRankedDoc, GapMetrics, RetrievalMetrics } from '@kb/shared';

/** A reranked chunk with its document + scores (subset of RankedCandidate). */
export interface RankedChunkLike {
  documentId: string;
  documentName: string;
  rerankScore: number;
  vectorScore: number;
  keywordScore: number;
  combinedScore: number;
}

/** Collapse the chunk-level reranked list to a document ranking (first = best). */
export function toDocRanking(ranked: RankedChunkLike[]): EvalRankedDoc[] {
  const out: EvalRankedDoc[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (seen.has(r.documentId)) continue;
    seen.add(r.documentId);
    out.push({
      documentId: r.documentId,
      documentName: r.documentName,
      rerankScore: r.rerankScore,
      vectorScore: r.vectorScore,
      keywordScore: r.keywordScore,
      combinedScore: r.combinedScore,
      rank: out.length + 1,
    });
  }
  return out;
}

/** Best (lowest) rank of any expected document in the ranking, or null if absent. */
export function bestExpectedRank(docRanking: EvalRankedDoc[], expectedIds: Set<string>): number | null {
  return docRanking.find((d) => expectedIds.has(d.documentId))?.rank ?? null;
}

/** Normalized per-case outcome — the input to all metric aggregation. */
export interface CaseOutcome {
  errored: boolean;
  hasExpectedDocs: boolean;
  expectedDocFound: boolean;
  expectedDocBestRank: number | null;
  expectedAnswerable: boolean;
  actualAnswerable: boolean;
  expectedGap: boolean;
  actualGap: boolean;
  gapReason: string | null;
}

function safeDiv(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

/**
 * Confusion matrix for a boolean predictor. `expected`/`actual` pick the positive
 * class (e.g. answerable, or gap). Raw counts are preserved alongside the ratios.
 */
function confusion(items: Array<{ expected: boolean; actual: boolean }>): ConfusionMatrix {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (const it of items) {
    if (it.expected && it.actual) tp += 1;
    else if (!it.expected && !it.actual) tn += 1;
    else if (!it.expected && it.actual) fp += 1;
    else fn += 1;
  }
  const total = tp + tn + fp + fn;
  return {
    truePositive: tp,
    trueNegative: tn,
    falsePositive: fp,
    falseNegative: fn,
    precision: safeDiv(tp, tp + fp),
    recall: safeDiv(tp, tp + fn),
    accuracy: safeDiv(tp + tn, total),
  };
}

function retrievalMetrics(cases: CaseOutcome[]): RetrievalMetrics {
  const withDocs = cases.filter((c) => c.hasExpectedDocs);
  const n = withDocs.length;
  const recallAtK = (k: number) =>
    safeDiv(withDocs.filter((c) => c.expectedDocBestRank != null && c.expectedDocBestRank <= k).length, n);
  const mrr = safeDiv(
    withDocs.reduce((sum, c) => sum + (c.expectedDocBestRank ? 1 / c.expectedDocBestRank : 0), 0),
    n,
  );
  return {
    casesWithExpectedDocs: n,
    expectedDocHitRate: safeDiv(withDocs.filter((c) => c.expectedDocFound).length, n),
    recallAt1: recallAtK(1),
    recallAt3: recallAtK(3),
    recallAt5: recallAtK(5),
    mrr,
  };
}

function gapMetrics(cases: CaseOutcome[]): GapMetrics {
  const conf = confusion(cases.map((c) => ({ expected: c.expectedGap, actual: c.actualGap })));
  const byReason = { no_relevant_knowledge: 0, weak_evidence: 0 };
  for (const c of cases) {
    if (c.actualGap && (c.gapReason === 'no_relevant_knowledge' || c.gapReason === 'weak_evidence')) {
      byReason[c.gapReason] += 1;
    }
  }
  return {
    expectedGaps: cases.filter((c) => c.expectedGap).length,
    detectedGaps: cases.filter((c) => c.actualGap).length,
    confusion: conf,
    falsePositiveRate: safeDiv(conf.falsePositive, conf.falsePositive + conf.trueNegative),
    falseNegativeRate: safeDiv(conf.falseNegative, conf.falseNegative + conf.truePositive),
    byReason,
  };
}

/** Aggregate the full metric set. Errored cases are excluded from every metric. */
export function aggregate(all: CaseOutcome[]): EvalMetrics {
  const cases = all.filter((c) => !c.errored);
  return {
    totalCases: all.length,
    evaluatedCases: cases.length,
    erroredCases: all.length - cases.length,
    retrieval: retrievalMetrics(cases),
    answerability: confusion(
      cases.map((c) => ({ expected: c.expectedAnswerable, actual: c.actualAnswerable })),
    ),
    gap: gapMetrics(cases),
  };
}
