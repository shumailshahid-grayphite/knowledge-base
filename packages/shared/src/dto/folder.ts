import { z } from 'zod';

/**
 * A folder name is a single path segment: no '/' (the materialized-path
 * delimiter) and a bounded length. Connector-mirrored names are sanitized to
 * the same shape before a path is built.
 */
export const FolderName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((s) => !s.includes('/'), { message: 'Folder name cannot contain "/"' });

export const CreateFolderRequest = z.object({
  name: FolderName,
  /** Parent folder to nest under; omitted/undefined = top-level. */
  parentId: z.string().uuid().optional(),
});
export type CreateFolderRequest = z.infer<typeof CreateFolderRequest>;

export const MoveFolderRequest = z.object({
  /** New parent; null moves the folder to the top level. */
  parentId: z.string().uuid().nullable(),
});
export type MoveFolderRequest = z.infer<typeof MoveFolderRequest>;

export const FolderResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Materialized path with leading+trailing slash, e.g. '/HR/2026/'. */
  path: z.string(),
  parentId: z.string().uuid().nullable(),
  origin: z.enum(['user', 'connector']),
  documentCount: z.number().int(),
  createdAt: z.string(),
});
export type FolderResponse = z.infer<typeof FolderResponse>;
