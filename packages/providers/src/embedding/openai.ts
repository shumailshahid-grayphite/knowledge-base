import type { EmbeddingProvider } from '@kb/shared';
import type { ProviderConfig } from '../config.js';

interface OpenAIEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

/** Real embeddings via the OpenAI (or OpenAI-compatible) embeddings endpoint. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;

  constructor(private readonly cfg: ProviderConfig) {
    if (!cfg.openaiApiKey) {
      throw new Error('OpenAIEmbeddingProvider requires OPENAI_API_KEY');
    }
    this.model = cfg.embeddingModel;
    this.dimension = cfg.embeddingDimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = { model: this.model, input: texts };
    // text-embedding-3-* support an explicit output dimension.
    if (this.model.startsWith('text-embedding-3')) {
      body.dimensions = this.dimension;
    }

    const res = await fetch(`${this.cfg.openaiBaseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.openaiApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as OpenAIEmbeddingResponse;
    // Ensure output order matches input order.
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text]);
    if (!vec) throw new Error('OpenAI returned no embedding');
    return vec;
  }
}
