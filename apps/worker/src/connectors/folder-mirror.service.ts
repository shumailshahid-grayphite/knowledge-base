import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

/** Sanitize one path segment: drop the delimiter, trim, cap length. */
function sanitizeSegment(name: string): string {
  return name.replace(/\//g, ' ').trim().slice(0, 64);
}

/** '/HR/2026/' -> ['HR', '2026']. */
export function segmentsFromPath(path: string): string[] {
  return path.split('/').map((s) => s.trim()).filter(Boolean);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * Mirrors a source folder path into the KB folder tree: resolves-or-creates each
 * nested folder (origin 'connector'), concurrency-safe via the
 * (knowledge_base_id, path) unique index. Same shape as the API's
 * FoldersService.resolveOrCreatePath, but usable from the worker.
 */
@Injectable()
export class FolderMirrorService {
  constructor(private readonly database: DatabaseService) {}

  async resolveOrCreatePath(
    organizationId: string,
    knowledgeBaseId: string,
    segments: string[],
    connectorId: string,
  ): Promise<{ id: string; path: string } | null> {
    let parentId: string | null = null;
    let path = '/';
    let leaf: { id: string; path: string } | null = null;
    for (const raw of segments) {
      const name = sanitizeSegment(raw);
      if (!name) continue;
      path = `${path}${name}/`;
      leaf = await this.upsert(organizationId, knowledgeBaseId, parentId, name, path, connectorId);
      parentId = leaf.id;
    }
    return leaf;
  }

  private async upsert(
    organizationId: string,
    knowledgeBaseId: string,
    parentId: string | null,
    name: string,
    path: string,
    connectorId: string,
  ): Promise<{ id: string; path: string }> {
    const existing = await this.database.db
      .selectFrom('folders')
      .select(['id', 'path'])
      .where('knowledge_base_id', '=', knowledgeBaseId)
      .where('path', '=', path)
      .executeTakeFirst();
    if (existing) return existing;

    try {
      return await this.database.db
        .insertInto('folders')
        .values({
          organization_id: organizationId,
          knowledge_base_id: knowledgeBaseId,
          parent_id: parentId,
          name,
          path,
          origin: 'connector',
          source_connector_id: connectorId,
        })
        .returning(['id', 'path'])
        .executeTakeFirstOrThrow();
    } catch (err) {
      if (isUniqueViolation(err)) {
        const row = await this.database.db
          .selectFrom('folders')
          .select(['id', 'path'])
          .where('knowledge_base_id', '=', knowledgeBaseId)
          .where('path', '=', path)
          .executeTakeFirst();
        if (row) return row;
      }
      throw err;
    }
  }
}
