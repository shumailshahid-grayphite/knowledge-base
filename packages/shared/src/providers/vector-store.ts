/**
 * Vector store abstraction. MVP impl writes to pgvector (chunks.embedding).
 * Swappable to Qdrant/Pinecone later without changing retrieval logic.
 */

export interface VectorRecord {
  chunkId: string;
  organizationId: string;
  spaceId: string;
  documentId: string;
  versionId: string;
  embedding: number[];
  embeddingModel: string;
}

export interface VectorSearchFilter {
  organizationId: string;
  spaceId: string;
  /** Optional metadata filters (documentType, sourceType, folderPath, tags, dateRange). */
  documentIds?: string[];
  sourceType?: string;
  folderPathPrefix?: string;
}

export interface VectorSearchHit {
  chunkId: string;
  documentId: string;
  versionId: string;
  score: number;
}

export interface VectorStore {
  /** Upsert embeddings for already-persisted chunk rows. */
  upsert(records: VectorRecord[]): Promise<void>;

  /** Cosine similarity search, always tenant/space pre-filtered. */
  search(
    queryEmbedding: number[],
    filter: VectorSearchFilter,
    topK: number,
  ): Promise<VectorSearchHit[]>;

  /** Remove all vectors for a version (idempotent reprocess). */
  deleteByVersion(versionId: string): Promise<void>;
}
