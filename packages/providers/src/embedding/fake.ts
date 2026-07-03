import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from '@kb/shared';

/**
 * Deterministic, key-free embeddings for local dev and tests.
 * The SAME input always yields the SAME unit vector (cosine-friendly).
 * Not semantically meaningful — only for exercising the pipeline.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-embedding';

  constructor(readonly dimension: number) {}

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => this.vector(t)));
  }

  embedOne(text: string): Promise<number[]> {
    return Promise.resolve(this.vector(text));
  }

  private vector(text: string): number[] {
    const out = new Array<number>(this.dimension);
    let block = createHash('sha256').update(text).digest();
    let i = 0;
    for (let d = 0; d < this.dimension; d++) {
      if (i >= block.length) {
        block = createHash('sha256').update(block).digest();
        i = 0;
      }
      out[d] = (block[i]! / 255) * 2 - 1; // map byte -> [-1, 1]
      i++;
    }
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
    return out.map((v) => v / norm);
  }
}
