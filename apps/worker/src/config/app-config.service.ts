import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  // Non-superuser runtime pool so RLS is enforced; falls back to DATABASE_URL.
  APP_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().min(1),
  QUEUE_PREFIX: z.string().default('kb'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/storage'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(96),
  // OCR fallback for image-only (scanned) PDF pages with no selectable text.
  OCR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  OCR_LANG: z.string().default('eng'),
  // Required only when connector sync is used (decrypting stored OAuth tokens).
  CONNECTOR_ENCRYPTION_KEY: z.string().optional(),
  // Periodic re-sync of connected sources so new/changed files flow in on their own.
  AUTO_SYNC_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AUTO_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

@Injectable()
export class AppConfigService {
  readonly env: WorkerEnv;

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid worker environment:\n${issues}`);
    }
    this.env = parsed.data;
  }
}
