import { z } from 'zod';

export const RetrievalFilters = z.object({
  sourceType: z.string().optional(),
  /** Scope to a folder and its whole subtree; resolved from folderId server-side. */
  folderId: z.string().uuid().optional(),
  folderPathPrefix: z.string().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
});
export type RetrievalFilters = z.infer<typeof RetrievalFilters>;

/**
 * An ephemeral document the user attaches/pastes for this one turn (e.g. a draft
 * to review). It is NOT ingested into the knowledge base or embedded — it only
 * lives in the prompt of this request; company docs are still what gets cited.
 */
export const QueryAttachment = z.object({
  name: z.string().min(1).max(255),
  text: z.string().min(1).max(50000),
});
export type QueryAttachment = z.infer<typeof QueryAttachment>;

export const QueryRequest = z.object({
  question: z.string().min(1).max(4000),
  topK: z.number().int().min(1).max(50).default(8),
  filters: RetrievalFilters.optional(),
  sessionId: z.string().uuid().optional(),
  attachment: QueryAttachment.optional(),
  /** Edit-and-resend: drop this message and everything after it, then re-ask. */
  editFromMessageId: z.string().uuid().optional(),
});
export type QueryRequest = z.infer<typeof QueryRequest>;

/** Extracted text from an uploaded attachment file (never persisted server-side). */
export const ExtractAttachmentResponse = z.object({
  name: z.string(),
  text: z.string(),
});
export type ExtractAttachmentResponse = z.infer<typeof ExtractAttachmentResponse>;

export const RenameChatRequest = z.object({
  title: z.string().min(1).max(120),
});
export type RenameChatRequest = z.infer<typeof RenameChatRequest>;

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
