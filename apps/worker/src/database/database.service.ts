import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDb, type DB } from '@kb/db';
import type { Kysely } from 'kysely';
import { AppConfigService } from '../config/app-config.service.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Kysely<DB>;

  constructor(config: AppConfigService) {
    this.db = createDb({ connectionString: config.env.DATABASE_URL });
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
