import { Global, Logger, Module } from '@nestjs/common';
import {
  createEmbeddingProvider,
  createLlmProvider,
  createReranker,
  resolveProviderConfig,
} from '@kb/providers';
import type { EmbeddingProvider, LlmProvider, Reranker } from '@kb/shared';
import { EMBEDDING_PROVIDER, LLM_PROVIDER, RERANKER } from './providers.tokens.js';

/**
 * Binds the embedding + LLM interfaces to concrete implementations chosen by
 * @kb/providers (real OpenAI vs deterministic fake). Retrieval/answer code only
 * sees the interfaces — provider/fake selection is isolated in the factory.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (): EmbeddingProvider => {
        const cfg = resolveProviderConfig(process.env);
        new Logger('Providers').log(`embedding provider: ${cfg.mode} (${cfg.embeddingModel})`);
        return createEmbeddingProvider(cfg);
      },
    },
    {
      provide: LLM_PROVIDER,
      useFactory: (): LlmProvider => {
        const cfg = resolveProviderConfig(process.env);
        new Logger('Providers').log(`llm provider: ${cfg.mode} (${cfg.llmModel})`);
        return createLlmProvider(cfg);
      },
    },
    {
      provide: RERANKER,
      useFactory: (): Reranker => createReranker(resolveProviderConfig(process.env)),
    },
  ],
  exports: [EMBEDDING_PROVIDER, LLM_PROVIDER, RERANKER],
})
export class ProvidersModule {}
