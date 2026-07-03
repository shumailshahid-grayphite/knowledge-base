import type { EmbeddingProvider, LlmProvider, Reranker } from '@kb/shared';
import type { ProviderConfig } from './config.js';
import { OpenAIEmbeddingProvider } from './embedding/openai.js';
import { FakeEmbeddingProvider } from './embedding/fake.js';
import { OpenAiLlmProvider } from './llm/openai.js';
import { FakeLlmProvider } from './llm/fake.js';
import { HeuristicReranker } from './reranker/heuristic.js';

/**
 * Factories are the ONLY place provider selection happens. Consumers (worker,
 * API, retrieval) depend on the interfaces from @kb/shared — never on a concrete
 * provider or on fake logic.
 *
 * To add Claude / Azure OpenAI / local models later: add a branch here (or a new
 * `mode`) and a class implementing the same interface. Nothing else changes.
 */
export function createEmbeddingProvider(cfg: ProviderConfig): EmbeddingProvider {
  return cfg.mode === 'openai'
    ? new OpenAIEmbeddingProvider(cfg)
    : new FakeEmbeddingProvider(cfg.embeddingDimension);
}

export function createLlmProvider(cfg: ProviderConfig): LlmProvider {
  return cfg.mode === 'openai' ? new OpenAiLlmProvider(cfg) : new FakeLlmProvider();
}

export function createReranker(_cfg: ProviderConfig): Reranker {
  // Only the deterministic heuristic ships today; branch here for future providers.
  return new HeuristicReranker();
}
