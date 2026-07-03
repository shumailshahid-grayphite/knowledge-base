import { Controller, Get } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async check(): Promise<{ status: string; db: boolean }> {
    let db = false;
    try {
      await sql`select 1`.execute(this.database.db);
      db = true;
    } catch {
      db = false;
    }
    return { status: db ? 'ok' : 'degraded', db };
  }
}
