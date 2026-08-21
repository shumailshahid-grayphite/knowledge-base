/**
 * Provider selection & config resolution.
 *
 * Rules:
 *   - AI_PROVIDER (openai|fake) is an explicit override.
 *   - Otherwise: OPENAI_API_KEY present -> openai; missing -> fake.
 *   - Dev without a key falls back to fake.
 *   - Production fails fast when it would otherwise silently use fake.
 */

export type ProviderMode = 'openai' | 'fake';

export type RerankMode = 'heuristic' | 'llm';

export interface ProviderConfig {
  mode: ProviderMode;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  embeddingModel: string;
  embeddingDimension: number;
  llmModel: string;
  /** Reranker selection: 'llm' (default with a real model) or 'heuristic'. */
  rerankMode: RerankMode;
}

type Env = Record<string, string | undefined>;

export function resolveProviderConfig(env: Env): ProviderConfig {
  const isProd = env.NODE_ENV === 'production';
  const explicit = env.AI_PROVIDER as ProviderMode | undefined;
  const hasKey = Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim());

  if (explicit && explicit !== 'openai' && explicit !== 'fake') {
    throw new Error(`Invalid AI_PROVIDER: ${explicit} (expected 'openai' or 'fake')`);
  }

  let mode: ProviderMode = explicit ?? (hasKey ? 'openai' : 'fake');

  if (mode === 'openai' && !hasKey) {
    if (isProd) {
      throw new Error('AI_PROVIDER=openai but OPENAI_API_KEY is missing (required in production)');
    }
    // Dev convenience: no key -> deterministic fake.
    mode = 'fake';
  }

  if (isProd && mode === 'fake' && explicit !== 'fake') {
    throw new Error(
      'No AI provider credentials in production. Set OPENAI_API_KEY, or explicitly set AI_PROVIDER=fake.',
    );
  }

  return {
    mode,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL?.replace(/\/$/, '') ?? 'https://api.openai.com/v1',
    embeddingModel: env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    embeddingDimension: Number(env.EMBEDDING_DIMENSION ?? 1536),
    llmModel: env.LLM_MODEL ?? 'gpt-4o-mini',
    // LLM reranker needs a real model; fake mode always uses the heuristic.
    // RERANK_MODE can force either (e.g. 'heuristic' to save latency/cost).
    rerankMode: resolveRerankMode(env.RERANK_MODE, mode),
  };
}

function resolveRerankMode(explicit: string | undefined, mode: ProviderMode): RerankMode {
  if (explicit === 'heuristic' || explicit === 'llm') {
    return explicit === 'llm' && mode !== 'openai' ? 'heuristic' : explicit;
  }
  return mode === 'openai' ? 'llm' : 'heuristic';
}
