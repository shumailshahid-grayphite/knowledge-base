import type { Reranker, RerankCandidate, RerankResult } from '@kb/shared';

/**
 * Deterministic heuristic reranker (no model, no key). Blends the upstream
 * hybrid score with lexical signals:
 *   - fraction of query terms present in the chunk text
 *   - fraction of query terms present in the document title
 *   - a small bonus when a precise location (page) is known
 * Same inputs always produce the same ordering — safe for tests.
 */
export class HeuristicReranker implements Reranker {
  readonly name = 'heuristic';

  // Weights sum to 1.0.
  private readonly wBase = 0.6;
  private readonly wTerm = 0.25;
  private readonly wTitle = 0.1;
  private readonly wLoc = 0.05;

  rerank(query: string, candidates: RerankCandidate[]): Promise<RerankResult[]> {
    const terms = tokenize(query);
    const results = candidates.map((c) => {
      const text = c.text.toLowerCase();
      const title = (c.title ?? '').toLowerCase();

      const termMatch = terms.length ? terms.filter((t) => text.includes(t)).length / terms.length : 0;
      const titleMatch = terms.length ? terms.filter((t) => title.includes(t)).length / terms.length : 0;
      const locBonus = c.metadata && c.metadata.pageNumber != null ? 1 : 0;

      const score =
        this.wBase * clamp01(c.baseScore) +
        this.wTerm * termMatch +
        this.wTitle * titleMatch +
        this.wLoc * locBonus;

      return { id: c.id, score };
    });
    return Promise.resolve(results);
  }
}

function tokenize(q: string): string[] {
  return [...new Set(q.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((t) => t.length > 2);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
