/**
 * Object storage abstraction. Local filesystem for dev; S3/Azure Blob later.
 * The worker reads bytes purely by `storageKey` from the queue payload.
 */
import type { Readable } from 'node:stream';

export interface StoredObjectMeta {
  contentType?: string;
  size?: number;
}

export interface StorageProvider {
  /** Store bytes under `key`. Returns the canonical key (may be normalized). */
  put(key: string, body: Buffer | Readable, meta?: StoredObjectMeta): Promise<string>;

  /** Fetch the full object as a Buffer. */
  get(key: string): Promise<Buffer>;

  /** Fetch as a stream (preferred for large files). */
  getStream(key: string): Promise<Readable>;

  exists(key: string): Promise<boolean>;

  delete(key: string): Promise<void>;
}
