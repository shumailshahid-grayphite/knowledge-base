import type { LlmProvider, Reranker, RerankCandidate, RerankResult } from '@kb/shared';

/**
 * LLM-as-reranker. Scores how well each candidate passage answers the query on a
 * 0..10 scale in a single completion, then normalizes to 0..1. This is the main
 * precision lever over the lexical heuristic: it demotes passages that merely
 * share keywords but are off-topic (e.g. an OWASP doc surfacing for a perks
 * question).
 *
 * Robustness: one call for the whole batch, temperature 0 (deterministic-ish),
 * passage text truncated to bound tokens. Any failure (network, unparseable
 * output, length mismatch) falls back to each candidate's upstream hybrid score,
 * so reranking can never make retrieval worse than the heuristic prior.
 */
export class LlmReranker implements Reranker {
  readonly name = 'llm';

  constructor(
    private readonly llm: LlmProvider,
    private readonly maxPassageChars = 600,
  ) {}

  async rerank(query: string, candidates: RerankCandidate[]): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];
    const fallback = () => candidates.map((c) => ({ id: c.id, score: c.baseScore }));

    const list = candidates
      .map((c, i) => {
        const title = c.title ? `(from "${c.title}") ` : '';
        return `[${i}] ${title}${c.text.replace(/\s+/g, ' ').slice(0, this.maxPassageChars)}`;
      })
      .join('\n\n');

    try {
      const res = await this.llm.complete({
        messages: [
          {
            role: 'system',
            content:
              'You rank retrieved passages by how well they help answer a user query. ' +
              'Rate each passage 0 (irrelevant) to 10 (directly answers the query). ' +
              `Reply with ONLY a JSON array of exactly ${candidates.length} integers in passage order — no prose, no keys.`,
          },
          {
            role: 'user',
            content: `Query: ${query}\n\nPassages:\n${list}\n\nJSON array of ${candidates.length} scores:`,
          },
        ],
        temperature: 0,
      });

      const scores = parseScoreArray(res.text, candidates.length);
      if (!scores) return fallback();
      return candidates.map((c, i) => ({ id: c.id, score: clamp01(scores[i]! / 10) }));
    } catch {
      return fallback();
    }
  }
}

/** Extract the first JSON array of `expected` numbers from model output. */
function parseScoreArray(text: string, expected: number): number[] | null {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    const arr = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(arr) || arr.length !== expected) return null;
    const nums = arr.map((n) => Number(n));
    if (nums.some((n) => !Number.isFinite(n))) return null;
    return nums;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
