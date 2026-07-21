import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { ConnectorType } from '@kb/db';
import type { RetrievalFilters } from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { likeStartsWith } from '../common/like.util.js';

export interface VectorHit {
  chunkId: string;
  documentId: string;
  score: number;
}

export interface VectorSearchParams {
  organizationId: string;
  spaceId: string;
  filters?: RetrievalFilters;
}

/**
 * pgvector cosine search, ALWAYS pre-filtered by organization + space (tenant
 * isolation) before similarity, with optional metadata filters.
 */
@Injectable()
export class VectorSearchService {
  constructor(private readonly database: DatabaseService) {}

  async search(embedding: number[], params: VectorSearchParams, topK: number): Promise<VectorHit[]> {
    const literal = `[${embedding.join(',')}]`;
    let q = this.database.db
      .selectFrom('chunks as c')
      .innerJoin('documents as d', 'd.id', 'c.document_id')
      .select(['c.id as chunkId', 'c.document_id as documentId'])
      .select(sql<number>`1 - (c.embedding <=> ${literal}::vector)`.as('score'))
      .where('c.organization_id', '=', params.organizationId)
      .where('c.knowledge_base_id', '=', params.spaceId)
      .where('c.embedding', 'is not', null)
      // Only completed documents' latest version.
      .where('d.status', '=', 'completed')
      .whereRef('c.version_id', '=', 'd.current_version_id')
      .orderBy(sql`c.embedding <=> ${literal}::vector`)
      .limit(topK);

    const f = params.filters;
    if (f?.sourceType) {
      q = q.where('d.source_type', '=', f.sourceType as ConnectorType);
    }
    if (f?.folderPathPrefix) {
      q = q.where(sql<boolean>`d.folder_path LIKE ${likeStartsWith(f.folderPathPrefix)} ESCAPE '\\'`);
    }
    if (f?.documentIds && f.documentIds.length > 0) {
      q = q.where('c.document_id', 'in', f.documentIds);
    }

    return q.execute();
  }
}
