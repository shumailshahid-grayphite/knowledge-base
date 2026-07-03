import { z } from 'zod';

export const ChunkConfig = z.object({
  chunkSize: z.number().int().positive().default(1000),
  chunkOverlap: z.number().int().min(0).default(150),
  splitter: z.enum(['recursive', 'fixed']).default('recursive'),
});
export type ChunkConfig = z.infer<typeof ChunkConfig>;

export const CreateSpaceRequest = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  embeddingModel: z.string().optional(),
  chunkConfig: ChunkConfig.partial().optional(),
});
export type CreateSpaceRequest = z.infer<typeof CreateSpaceRequest>;

export const SpaceResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  embeddingModel: z.string(),
  chunkConfig: ChunkConfig,
  documentCount: z.number().int().optional(),
  createdAt: z.string(),
});
export type SpaceResponse = z.infer<typeof SpaceResponse>;
