import { Injectable, Logger } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { StorageProvider, StoredObjectMeta } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';

/** Filesystem-backed storage for dev. Mirrors the API's provider (same root). */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;

  constructor(config: AppConfigService) {
    this.root = resolve(process.cwd(), config.env.STORAGE_LOCAL_DIR);
  }

  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root)) {
      throw new Error(`Illegal storage key: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer | Readable, _meta?: StoredObjectMeta): Promise<string> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await writeFile(full, body);
    } else {
      await pipeline(body, createWriteStream(full));
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
