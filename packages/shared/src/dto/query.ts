import { z } from 'zod';

export const RetrievalFilters = z.object({
  sourceType: z.string().optional(),
  folderPathPrefix: z.string().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
});
export type RetrievalFilters = z.infer<typeof RetrievalFilters>;

export const QueryRequest = z.object({
  question: z.string().min(1).max(4000),
  topK: z.number().int().min(1).max(50).default(8),
  filters: RetrievalFilters.optional(),
  sessionId: z.string().uuid().optional(),
});
export type QueryRequest = z.infer<typeof QueryRequest>;

export const Citation = z.object({
  chunkId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentName: z.string(),
  sourceUrl: z.string().nullable(),
  pageNumber: z.number().int().nullable(),
  score: z.number(),
});
export type Citation = z.infer<typeof Citation>;

export const QueryResponse = z.object({
  answer: z.string(),
  /** true when the knowledge space had no relevant context. */
  noAnswer: z.boolean(),
  citations: z.array(Citation),
  sessionId: z.string().uuid().nullable(),
});
export type QueryResponse = z.infer<typeof QueryResponse>;
