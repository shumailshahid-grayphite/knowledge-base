import { Inject, Injectable } from '@nestjs/common';
import type { EmbeddingProvider } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';
import { EMBEDDING_PROVIDER } from '../providers/providers.tokens.js';

/**
 * Orchestrates embedding generation (batching, ordering) over whatever
 * EmbeddingProvider is bound. Knows nothing about OpenAI vs fake.
 */
@Injectable()
export class EmbeddingService {
  private readonly batchSize: number;

  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
    config: AppConfigService,
  ) {
    this.batchSize = config.env.EMBEDDING_BATCH_SIZE;
  }

  get model(): string {
    return this.provider.model;
  }

  get dimension(): number {
    return this.provider.dimension;
  }

  async embedAll(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const vectors = await this.provider.embed(batch);
      out.push(...vectors);
    }
    return out;
  }
}
