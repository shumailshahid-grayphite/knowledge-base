import { z } from 'zod';

export const DocumentResponse = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string().nullable(),
  fileSize: z.number().nullable(),
  sourceType: z.enum([
    'upload',
    'gdrive',
    'sharepoint',
    'onedrive',
    'dropbox',
    'notion',
    'confluence',
  ]),
  sourceUrl: z.string().nullable(),
  folderId: z.string().uuid().nullable(),
  folderPath: z.string().nullable(),
  status: z.enum(['uploaded', 'queued', 'processing', 'completed', 'failed', 'needs_review']),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DocumentResponse = z.infer<typeof DocumentResponse>;

export const ListDocumentsQuery = z.object({
  status: z
    .enum(['uploaded', 'queued', 'processing', 'completed', 'failed', 'needs_review'])
    .optional(),
  /** Restrict to documents directly in this folder (exact match, not subtree). */
  folderId: z.string().uuid().optional(),
  /** Only documents not in any folder (the KB "root"). Ignored if folderId is set. */
  unfiled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuery>;
