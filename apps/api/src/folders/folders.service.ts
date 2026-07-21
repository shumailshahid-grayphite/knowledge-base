import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { FoldersTable } from '@kb/db';
import {
  type AuthUser,
  type CreateFolderRequest,
  type FolderResponse,
} from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { SpacesService } from '../spaces/spaces.service.js';
import { likeStartsWith } from '../common/like.util.js';

type FolderRow = Selectable<FoldersTable>;

/** Postgres unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Sanitize a single path segment: trim, drop the delimiter, cap length. */
export function sanitizeSegment(name: string): string {
  const clean = name.replace(/\//g, ' ').trim().slice(0, 64);
  if (!clean) throw new BadRequestException('Folder name is empty after sanitization');
  return clean;
}

@Injectable()
export class FoldersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly spaces: SpacesService,
  ) {}

  /** Create a folder (nested under parentId, or top-level). Idempotent on path. */
  async create(
    user: AuthUser,
    spaceId: string,
    input: CreateFolderRequest,
  ): Promise<FolderResponse> {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    const name = sanitizeSegment(input.name);

    let parentPath = '/';
    if (input.parentId) {
      const parent = await this.requireFolder(user.organizationId, spaceId, input.parentId);
      parentPath = parent.path;
    }
    const path = `${parentPath}${name}/`;

    try {
      const row = await this.database.db
        .insertInto('folders')
        .values({
          organization_id: user.organizationId,
          knowledge_base_id: spaceId,
          parent_id: input.parentId ?? null,
          name,
          path,
          origin: 'user',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return this.toResponse(row, 0);
    } catch (err) {
      // Folder already exists at this path -> return it (idempotent).
      if (isUniqueViolation(err)) {
        const existing = await this.database.db
          .selectFrom('folders')
          .selectAll()
          .where('knowledge_base_id', '=', spaceId)
          .where('path', '=', path)
          .executeTakeFirst();
        if (existing) return this.toResponse(existing, await this.countDocs(existing.id));
      }
      throw err;
    }
  }

  /** All folders in the space with per-folder (direct) document counts. */
  async list(user: AuthUser, spaceId: string): Promise<FolderResponse[]> {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    const rows = await this.database.db
      .selectFrom('folders')
      .selectAll('folders')
      .select((eb) =>
        eb
          .selectFrom('documents')
          .whereRef('documents.folder_id', '=', 'folders.id')
          .select(eb.fn.countAll<string>().as('c'))
          .as('document_count'),
      )
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId)
      .orderBy('path', 'asc')
      .execute();

    return rows.map((r) =>
      this.toResponse(r, Number((r as { document_count?: string }).document_count ?? 0)),
    );
  }

  /**
   * Delete a folder and its whole subtree. Documents in any affected folder are
   * unfiled (folder_id/folder_path nulled) in the same transaction BEFORE the
   * cascade fires, so no stale folder_path survives to match a re-created path.
   */
  async delete(user: AuthUser, spaceId: string, folderId: string): Promise<void> {
    const folder = await this.requireFolder(user.organizationId, spaceId, folderId);
    const subtree = likeStartsWith(folder.path);

    await this.database.db.transaction().execute(async (trx) => {
      const ids = (
        await trx
          .selectFrom('folders')
          .select('id')
          .where('knowledge_base_id', '=', spaceId)
          .where(sql<boolean>`path LIKE ${subtree} ESCAPE '\\'`)
          .execute()
      ).map((r) => r.id);

      if (ids.length > 0) {
        await trx
          .updateTable('documents')
          .set({ folder_id: null, folder_path: null })
          .where('folder_id', 'in', ids)
          .execute();
      }
      // Deleting the root cascades to descendant folder rows (parent_id ON DELETE CASCADE).
      await trx.deleteFrom('folders').where('id', '=', folder.id).execute();
    });
  }

  /**
   * Move a folder under a new parent (or to top level when parentId is null) and
   * rewrite the materialized path for the whole subtree in one transaction.
   */
  async move(
    user: AuthUser,
    spaceId: string,
    folderId: string,
    parentId: string | null,
  ): Promise<FolderResponse> {
    const folder = await this.requireFolder(user.organizationId, spaceId, folderId);

    let newParentPath = '/';
    if (parentId) {
      if (parentId === folderId) throw new BadRequestException('A folder cannot be its own parent');
      const parent = await this.requireFolder(user.organizationId, spaceId, parentId);
      if (parent.path.startsWith(folder.path)) {
        throw new BadRequestException('Cannot move a folder into its own subtree');
      }
      newParentPath = parent.path;
    }
    const oldPath = folder.path;
    const newPath = `${newParentPath}${folder.name}/`;
    if (newPath === oldPath) return this.toResponse(folder, await this.countDocs(folder.id));

    await this.database.db.transaction().execute(async (trx) => {
      const subtree = await trx
        .selectFrom('folders')
        .select(['id', 'path'])
        .where('knowledge_base_id', '=', spaceId)
        .where(sql<boolean>`path LIKE ${likeStartsWith(oldPath)} ESCAPE '\\'`)
        .execute();

      for (const f of subtree) {
        const rebased = newPath + f.path.slice(oldPath.length); // splice new prefix in
        await trx
          .updateTable('folders')
          .set({ path: rebased, ...(f.id === folder.id ? { parent_id: parentId } : {}) })
          .where('id', '=', f.id)
          .execute();
        await trx
          .updateTable('documents')
          .set({ folder_path: rebased })
          .where('folder_id', '=', f.id)
          .execute();
      }
    });

    const moved = await this.requireFolder(user.organizationId, spaceId, folderId);
    return this.toResponse(moved, await this.countDocs(folderId));
  }

  /**
   * Resolve (creating as needed) the chain of folders for a materialized path
   * like '/HR/2026/Policies/'. Idempotent and concurrency-safe via the
   * (knowledge_base_id, path) unique index. Returns the leaf folder. Used by connector
   * mirroring; origin defaults to 'connector'.
   */
  async resolveOrCreatePath(
    organizationId: string,
    spaceId: string,
    segments: string[],
    opts: { origin?: 'user' | 'connector'; sourceConnectorId?: string | null } = {},
  ): Promise<FolderRow> {
    const origin = opts.origin ?? 'connector';
    let parentId: string | null = null;
    let path = '/';
    let leaf: FolderRow | null = null;

    for (const raw of segments) {
      const name = sanitizeSegment(raw);
      path = `${path}${name}/`;
      leaf = await this.upsertFolder(organizationId, spaceId, {
        parentId,
        name,
        path,
        origin,
        sourceConnectorId: opts.sourceConnectorId ?? null,
      });
      parentId = leaf.id;
    }
    if (!leaf) throw new BadRequestException('Empty folder path');
    return leaf;
  }

  private async upsertFolder(
    organizationId: string,
    spaceId: string,
    f: {
      parentId: string | null;
      name: string;
      path: string;
      origin: 'user' | 'connector';
      sourceConnectorId: string | null;
    },
  ): Promise<FolderRow> {
    const existing = await this.database.db
      .selectFrom('folders')
      .selectAll()
      .where('knowledge_base_id', '=', spaceId)
      .where('path', '=', f.path)
      .executeTakeFirst();
    if (existing) return existing;

    try {
      return await this.database.db
        .insertInto('folders')
        .values({
          organization_id: organizationId,
          knowledge_base_id: spaceId,
          parent_id: f.parentId,
          name: f.name,
          path: f.path,
          origin: f.origin,
          source_connector_id: f.sourceConnectorId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      // Lost a concurrent create -> read the winner.
      if (isUniqueViolation(err)) {
        const row = await this.database.db
          .selectFrom('folders')
          .selectAll()
          .where('knowledge_base_id', '=', spaceId)
          .where('path', '=', f.path)
          .executeTakeFirst();
        if (row) return row;
      }
      throw err;
    }
  }

  /** Tenant+space-scoped folder fetch; throws 404 if not found. */
  async requireFolder(
    organizationId: string,
    spaceId: string,
    folderId: string,
  ): Promise<FolderRow> {
    const row = await this.database.db
      .selectFrom('folders')
      .selectAll()
      .where('id', '=', folderId)
      .where('knowledge_base_id', '=', spaceId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Folder not found');
    return row;
  }

  private async countDocs(folderId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom('documents')
      .select((eb) => eb.fn.countAll<string>().as('c'))
      .where('folder_id', '=', folderId)
      .executeTakeFirst();
    return Number(row?.c ?? 0);
  }

  private toResponse(row: FolderRow, documentCount: number): FolderResponse {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      parentId: row.parent_id,
      origin: row.origin as 'user' | 'connector',
      documentCount,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
