import { Injectable, NotFoundException } from '@nestjs/common';
import type { Selectable } from 'kysely';
import type { KnowledgeBaseTable } from '@kb/db';
import {
  ChunkConfig,
  type AuthUser,
  type CreateSpaceRequest,
  type SpaceResponse,
} from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { AppConfigService } from '../config/app-config.service.js';

@Injectable()
export class SpacesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
  ) {}

  async create(user: AuthUser, input: CreateSpaceRequest): Promise<SpaceResponse> {
    const chunkConfig = ChunkConfig.parse({ ...(input.chunkConfig ?? {}) });
    const row = await this.database.db
      .insertInto('knowledge_base')
      .values({
        organization_id: user.organizationId,
        name: input.name,
        description: input.description ?? null,
        created_by: user.id,
        embedding_model: input.embeddingModel ?? this.config.env.EMBEDDING_MODEL,
        chunk_config: JSON.stringify(chunkConfig),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.toResponse(row, 0);
  }

  /**
   * The org's single implicit knowledge base. Returns the oldest space, creating
   * a "Company Knowledge Base" if none exists. Concurrency-safe via the
   * knowledge_base (organization_id, lower(name)) unique index.
   */
  async getOrCreateDefault(user: AuthUser): Promise<SpaceResponse> {
    const existing = await this.database.db
      .selectFrom('knowledge_base')
      .selectAll()
      .where('organization_id', '=', user.organizationId)
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (existing) return this.get(user, existing.id);

    try {
      return await this.create(user, { name: 'Company Knowledge Base' });
    } catch (err) {
      // Lost a concurrent create -> read the winner.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        const row = await this.database.db
          .selectFrom('knowledge_base')
          .selectAll()
          .where('organization_id', '=', user.organizationId)
          .orderBy('created_at', 'asc')
          .limit(1)
          .executeTakeFirstOrThrow();
        return this.get(user, row.id);
      }
      throw err;
    }
  }

  async list(user: AuthUser): Promise<SpaceResponse[]> {
    const rows = await this.database.db
      .selectFrom('knowledge_base')
      .selectAll('knowledge_base')
      .select((eb) =>
        eb
          .selectFrom('documents')
          .whereRef('documents.knowledge_base_id', '=', 'knowledge_base.id')
          .select(eb.fn.countAll<string>().as('c'))
          .as('document_count'),
      )
      .where('organization_id', '=', user.organizationId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map((r) =>
      this.toResponse(r, Number((r as { document_count?: string }).document_count ?? 0)),
    );
  }

  async get(user: AuthUser, spaceId: string): Promise<SpaceResponse> {
    const row = await this.requireSpace(user.organizationId, spaceId);
    const count = await this.database.db
      .selectFrom('documents')
      .select((eb) => eb.fn.countAll<string>().as('c'))
      .where('knowledge_base_id', '=', spaceId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    return this.toResponse(row, Number(count?.c ?? 0));
  }

  /** Tenant-scoped existence check; throws 404 if the space is not in the org. */
  async requireSpace(
    organizationId: string,
    spaceId: string,
  ): Promise<Selectable<KnowledgeBaseTable>> {
    const row = await this.database.db
      .selectFrom('knowledge_base')
      .selectAll()
      .where('id', '=', spaceId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException('Knowledge space not found');
    }
    return row;
  }

  private toResponse(row: Selectable<KnowledgeBaseTable>, documentCount: number): SpaceResponse {
    const chunkConfig = ChunkConfig.parse(
      typeof row.chunk_config === 'string' ? JSON.parse(row.chunk_config) : row.chunk_config,
    );
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      embeddingModel: row.embedding_model,
      chunkConfig,
      documentCount,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
