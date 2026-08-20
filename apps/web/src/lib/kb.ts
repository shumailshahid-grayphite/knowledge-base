'use client';

import useSWR from 'swr';
import type { FolderResponse, SpaceResponse } from '@kb/shared';
import { API_BASE, fetcher, getToken } from '@/lib/api';

/** SWR keys shared between the sidebar "New" actions and the browser view. */
export const foldersKey = (spaceId: string) => `/spaces/${spaceId}/folders`;
export const docsKey = (spaceId: string, folderId: string | null) =>
  `/spaces/${spaceId}/documents?${folderId ? `folderId=${folderId}` : 'unfiled=true'}`;

/** Multipart upload of one or more files into a folder (null = KB root). */
export async function uploadDocuments(
  spaceId: string,
  folderId: string | null,
  files: FileList | File[],
): Promise<void> {
  for (const file of Array.from(files)) {
    const form = new FormData();
    form.append('file', file);
    if (folderId) form.append('folderId', folderId);
    const res = await fetch(`${API_BASE}/spaces/${spaceId}/documents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${getToken() ?? ''}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error((await res.json().catch(() => ({}))).message ?? `Upload failed (${res.status})`);
    }
  }
}

/** Parse the folder id from a /folders/[id] path (null at KB root). */
export function folderIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/folders\/([^/]+)/);
  return m?.[1] ?? null;
}

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

export interface ChatSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** SWR key for the chat list — shared by the sidebar and the chat view. */
export const chatsKey = (spaceId: string) => `/spaces/${spaceId}/chats`;

export function useChats(spaceId: string | undefined) {
  const { data } = useSWR<ChatSummary[]>(spaceId ? chatsKey(spaceId) : null, fetcher);
  return { chats: data };
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
