/**
 * Embedding provider abstraction. OpenAI is the MVP implementation; swap by
 * config (EMBEDDING_PROVIDER) without touching the pipeline. A space pins one
 * model+dimension so vectors never mix.
 */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;

  /** Batch-embed. Order of results matches order of inputs. */
  embed(texts: string[]): Promise<number[][]>;

  /** Convenience single-text embed (e.g. a query). */
  embedOne(text: string): Promise<number[]>;
}
