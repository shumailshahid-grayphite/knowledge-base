'use client';

import useSWR from 'swr';
import type { FolderResponse, SpaceResponse } from '@kb/shared';
import { fetcher } from '@/lib/api';

/**
 * The single implicit "Company Knowledge Base" for the org. The UI navigates by
 * folders, not spaces, so the space id is fetched once and reused everywhere.
 */
export function useDefaultSpace() {
  const { data, error, isLoading } = useSWR<SpaceResponse>('/spaces/default', fetcher);
  return { space: data, spaceId: data?.id, error, isLoading };
}

export function useFolders(spaceId: string | undefined) {
  const { data, error, isLoading } = useSWR<FolderResponse[]>(
    spaceId ? `/spaces/${spaceId}/folders` : null,
    fetcher,
  );
  return { folders: data, error, isLoading };
}

/** Build the ancestor chain (root → folder) from the flat folder list. */
export function folderTrail(folders: FolderResponse[], folderId: string): FolderResponse[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const trail: FolderResponse[] = [];
  let cur = byId.get(folderId);
  while (cur) {
    trail.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return trail;
}
