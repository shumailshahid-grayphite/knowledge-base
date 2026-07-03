/**
 * Reranker abstraction. A deterministic heuristic reranker ships for MVP/dev;
 * a provider-based one (e.g. Cohere Rerank, a cross-encoder service) can be
 * swapped in later without touching RetrievalService.
 */

export interface RerankCandidate {
  id: string;
  /** The chunk text to score against the query. */
  text: string;
  /** Optional title / document name for title-match signals. */
  title?: string;
  /** Optional structured signals (e.g. { pageNumber }). */
  metadata?: Record<string, unknown>;
  /** Upstream hybrid score (0..1) used as a prior. */
  baseScore: number;
}

export interface RerankResult {
  id: string;
  score: number;
}

export interface Reranker {
  readonly name: string;
  /** Return every candidate id with a new score (order-independent; caller sorts). */
  rerank(query: string, candidates: RerankCandidate[]): Promise<RerankResult[]>;
}
