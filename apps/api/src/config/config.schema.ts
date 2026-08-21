import { z } from 'zod';

/** Validated environment. Bootstrap fails fast if anything required is missing. */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),

  // Admin connection (migrations/seed run as this superuser). RLS is bypassed by superusers.
  DATABASE_URL: z.string().min(1),
  // Runtime pool connection: a NON-superuser role so RLS (app.current_org) is enforced.
  // Falls back to DATABASE_URL when unset (dev without RLS armed).
  APP_DATABASE_URL: z.string().optional(),

  REDIS_URL: z.string().min(1),
  QUEUE_PREFIX: z.string().default('kb'),

  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().default('7d'),
  // Dev convenience: allow password-less login for seeded users. NEVER in prod.
  AUTH_DEV_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/storage'),

  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),

  // ---- Hybrid retrieval tuning ----
  // Candidates fetched from EACH search (vector, keyword) before merge/rerank.
  RETRIEVAL_CANDIDATE_POOL: z.coerce.number().int().positive().default(30),
  RETRIEVAL_VECTOR_WEIGHT: z.coerce.number().min(0).max(1).default(0.65),
  RETRIEVAL_KEYWORD_WEIGHT: z.coerce.number().min(0).max(1).default(0.35),
  // Max chunks per document unless a chunk clears the high-relevance bar.
  RETRIEVAL_MAX_PER_DOC: z.coerce.number().int().positive().default(3),
  RETRIEVAL_HIGH_RELEVANCE: z.coerce.number().min(0).max(1).default(0.85),
  // How many top merged candidates to feed the reranker (bounds LLM-rerank cost).
  RETRIEVAL_RERANK_POOL: z.coerce.number().int().positive().default(24),
  // Drop candidates whose rerank score is below this, so weak/off-topic chunks
  // never become context (0 relevance in => general-knowledge answer, no citations).
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
  // Approx token budget for the final context set.
  RETRIEVAL_TOKEN_BUDGET: z.coerce.number().int().positive().default(6000),

  // ---- Knowledge Gaps V1 ----
  KNOWLEDGE_GAPS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Adequacy bar, SEPARATE from RETRIEVAL_MIN_SCORE: a surviving top score below
  // this flags weak_evidence. Initial heuristic — tune from real usage, not a
  // permanent product threshold.
  KNOWLEDGE_GAPS_ADEQUACY_SCORE: z.coerce.number().min(0).max(1).default(0.4),
  // Cosine similarity above which a new signal joins an existing gap. Calibrated
  // for text-embedding-3-small, where differently-phrased same-topic questions sit
  // around 0.7 and unrelated topics well below 0.5. Also a tunable heuristic.
  KNOWLEDGE_GAPS_SIMILARITY: z.coerce.number().min(0).max(1).default(0.65),

  // ---- Connectors / OAuth ----
  CONNECTOR_ENCRYPTION_KEY: z.string().optional(), // base64 of 32 bytes; required to use connectors
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  WEB_PUBLIC_URL: z.string().default('http://localhost:3000'),
  OAUTH_STATE_SECRET: z.string().optional(), // falls back to JWT_SECRET
});

export type Env = z.infer<typeof EnvSchema>;
