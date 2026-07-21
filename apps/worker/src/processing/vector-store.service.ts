import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { VectorRecord, VectorSearchFilter, VectorSearchHit, VectorStore } from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';

/** pgvector-backed VectorStore. Writes embeddings onto existing chunk rows. */
@Injectable()
export class VectorStoreService implements VectorStore {
  constructor(private readonly database: DatabaseService) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.database.db.transaction().execute(async (trx) => {
      for (const r of records) {
        const literal = toVectorLiteral(r.embedding);
        await sql`
          update chunks
             set embedding = ${literal}::vector,
                 embedding_model = ${r.embeddingModel}
           where id = ${r.chunkId}
        `.execute(trx);
      }
    });
  }

  async deleteByVersion(versionId: string): Promise<void> {
    await this.database.db.deleteFrom('chunks').where('version_id', '=', versionId).execute();
  }

  /** Cosine similarity search, tenant/space pre-filtered. (Retrieval API also uses this pattern.) */
  async search(
    queryEmbedding: number[],
    filter: VectorSearchFilter,
    topK: number,
  ): Promise<VectorSearchHit[]> {
    const literal = toVectorLiteral(queryEmbedding);
    const result = await sql<VectorSearchHit>`
      select id as "chunkId",
             document_id as "documentId",
             version_id as "versionId",
             1 - (embedding <=> ${literal}::vector) as score
        from chunks
       where organization_id = ${filter.organizationId}
         and knowledge_base_id = ${filter.spaceId}
         and embedding is not null
       order by embedding <=> ${literal}::vector
       limit ${topK}
    `.execute(this.database.db);
    return result.rows;
  }
}

/** Serialize a JS number[] to pgvector's text input format: [1,2,3]. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
