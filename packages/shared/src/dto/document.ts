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
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuery>;
