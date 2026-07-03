import { Global, Logger, Module } from '@nestjs/common';
import { createEmbeddingProvider, resolveProviderConfig } from '@kb/providers';
import type { EmbeddingProvider } from '@kb/shared';
import { EMBEDDING_PROVIDER } from './providers.tokens.js';

/**
 * Binds the EmbeddingProvider interface to a concrete implementation chosen by
 * @kb/providers (real OpenAI vs deterministic fake). The worker only ever sees
 * the interface — provider/fake selection is isolated in the factory.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (): EmbeddingProvider => {
        const cfg = resolveProviderConfig(process.env);
        new Logger('Providers').log(
          `embedding provider: ${cfg.mode} (model=${cfg.embeddingModel}, dim=${cfg.embeddingDimension})`,
        );
        return createEmbeddingProvider(cfg);
      },
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class ProvidersModule {}
