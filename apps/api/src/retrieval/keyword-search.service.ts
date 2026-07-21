import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { ConnectorType } from '@kb/db';
import { DatabaseService } from '../database/database.service.js';
import { likeStartsWith } from '../common/like.util.js';
import type { VectorSearchParams } from './vector-search.service.js';

export interface KeywordHit {
  chunkId: string;
  documentId: string;
  score: number; // ts_rank_cd, unbounded
}

/**
 * PostgreSQL full-text search over the existing `chunks_content_fts` GIN index
 * (`to_tsvector('english', content)`). Uses websearch_to_tsquery so quoted
 * phrases / OR terms work. Same tenant/space/completed-latest scoping as vector.
 */
@Injectable()
export class KeywordSearchService {
  constructor(private readonly database: DatabaseService) {}

  async search(query: string, params: VectorSearchParams, topK: number): Promise<KeywordHit[]> {
    const tsquery = sql`websearch_to_tsquery('english', ${query})`;
    const tsvector = sql`to_tsvector('english', c.content)`;

    let q = this.database.db
      .selectFrom('chunks as c')
      .innerJoin('documents as d', 'd.id', 'c.document_id')
      .select(['c.id as chunkId', 'c.document_id as documentId'])
      .select(sql<number>`ts_rank_cd(${tsvector}, ${tsquery})`.as('score'))
      .where('c.organization_id', '=', params.organizationId)
      .where('c.knowledge_base_id', '=', params.spaceId)
      .where('d.status', '=', 'completed')
      .whereRef('c.version_id', '=', 'd.current_version_id')
      .where(sql<boolean>`${tsvector} @@ ${tsquery}`)
      .orderBy('score', 'desc')
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
