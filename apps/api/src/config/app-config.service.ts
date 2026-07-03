import { Injectable } from '@nestjs/common';
import { EnvSchema, type Env } from './config.schema.js';

@Injectable()
export class AppConfigService {
  readonly env: Env;

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    this.env = parsed.data;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
}
