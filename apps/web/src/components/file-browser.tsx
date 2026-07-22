'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import {
  ChevronRight,
  Cloud,
  File as FileIcon,
  Folder,
  LayoutGrid,
  List as ListIcon,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { DocumentResponse } from '@kb/shared';
import { apiFetch, fetcher } from '@/lib/api';
import { useDefaultSpace, useFolders, folderTrail, uploadDocuments, foldersKey, docsKey } from '@/lib/kb';
import { StatusBadge } from '@/components/status-badge';

const ACTIVE = new Set(['uploaded', 'queued', 'processing']);

export function FileBrowser({ folderId }: { folderId: string | null }) {
  const router = useRouter();
  const { spaceId } = useDefaultSpace();
  const { folders } = useFolders(spaceId);

  const children = folders?.filter((f) => f.parentId === folderId) ?? [];
  const trail = folders && folderId ? folderTrail(folders, folderId) : [];
  const dKey = spaceId ? docsKey(spaceId, folderId) : null;
  const { data: docs } = useSWR<DocumentResponse[]>(dKey, fetcher, {
    refreshInterval: (latest) => (latest?.some((d) => ACTIVE.has(d.status)) ? 3000 : 0),
  });

  const [view, setView] = useState<'list' | 'grid'>('list');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [folderId]);

  async function onDrop(files: FileList) {
    if (!files.length || !spaceId) return;
    setBusy(true);
    setError(null);
    try {
      await uploadDocuments(spaceId, folderId, files);
      await Promise.all([mutate(dKey), mutate(foldersKey(spaceId))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder(id: string, name: string) {
    if (!spaceId || !confirm(`Delete "${name}" and everything inside it? Documents will be moved to the root.`)) return;
    await apiFetch(`/spaces/${spaceId}/folders/${id}`, { method: 'DELETE' });
    await Promise.all([mutate(foldersKey(spaceId)), mutate(dKey)]);
  }

  async function reprocess(id: string) {
    await apiFetch(`/documents/${id}/reprocess`, { method: 'POST' });
    await mutate(dKey);
  }

  const empty = children.length === 0 && (docs?.length ?? 0) === 0;

  return (
    <div
      className="space-y-5"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDrop(e.dataTransfer.files);
      }}
    >
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-xl">
          <button onClick={() => router.push('/')} className="font-semibold hover:underline">
            {folderId ? 'Knowledge Base' : 'My Knowledge Base'}
          </button>
          {trail.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
              {f.id === folderId ? (
                <span className="font-semibold">{f.name}</span>
              ) : (
                <button onClick={() => router.push(`/folders/${f.id}`)} className="text-muted-foreground hover:underline">
                  {f.name}
                </button>
              )}
            </span>
          ))}
        </div>
        <button
          onClick={() => router.push(`/ask${folderId ? `?folderId=${folderId}` : ''}`)}
          className="flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm hover:bg-accent"
        >
          <Search className="h-4 w-4" /> Ask
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {busy && <p className="text-sm text-muted-foreground">Uploading…</p>}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 m-4 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary/5">
          <div className="flex items-center gap-2 text-primary">
            <Upload className="h-6 w-6" /> Drop files to upload
          </div>
        </div>
      )}

      {/* Folders */}
      {children.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-foreground">Folders</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {children.map((f) => (
              <div
                key={f.id}
                onDoubleClick={() => router.push(`/folders/${f.id}`)}
                onClick={() => router.push(`/folders/${f.id}`)}
                className="group flex cursor-pointer items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 hover:bg-muted"
              >
                {f.origin === 'connector' ? (
                  <Cloud className="h-5 w-5 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="h-5 w-5 shrink-0 fill-muted-foreground/30 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{f.documentCount} file(s)</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFolder(f.id, f.name);
                  }}
                  className="opacity-0 transition hover:text-destructive group-hover:opacity-100"
                  title="Delete folder"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Files */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Files</h2>
          <div className="flex overflow-hidden rounded-full border">
            <button
              onClick={() => setView('list')}
              className={`px-2.5 py-1 ${view === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
              title="List"
            >
              <ListIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('grid')}
              className={`px-2.5 py-1 ${view === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
              title="Grid"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {empty ? (
          <div className="grid h-56 place-items-center rounded-xl border border-dashed text-center text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8" />
              <p>Drop files here, or use <span className="font-medium">New</span> to upload or connect a source.</p>
            </div>
          </div>
        ) : view === 'list' ? (
          <div className="overflow-hidden rounded-xl border">
            <div className="grid grid-cols-[1fr_140px_200px] gap-2 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
              <div>Name</div>
              <div>Status</div>
              <div>Location</div>
            </div>
            {docs?.map((d) => (
              <div key={d.id} className="group grid grid-cols-[1fr_140px_200px] items-center gap-2 border-b px-4 py-2.5 last:border-0 hover:bg-accent/40">
                <div className="flex min-w-0 items-center gap-2">
                  <FileIcon className="h-5 w-5 shrink-0 text-primary" />
                  <span className="truncate text-sm">{d.fileName}</span>
                  {(d.status === 'failed' || d.status === 'completed' || d.status === 'needs_review') && (
                    <button
                      onClick={() => reprocess(d.id)}
                      className="opacity-0 transition hover:text-foreground group-hover:opacity-100"
                      title="Reprocess"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div><StatusBadge status={d.status} /></div>
                <div className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="truncate">{d.folderPath ?? 'Knowledge Base'}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {docs?.map((d) => (
              <div key={d.id} className="group rounded-lg border p-3 hover:bg-accent/40">
                <div className="mb-6 flex items-start justify-between">
                  <FileIcon className="h-6 w-6 text-primary" />
                  <StatusBadge status={d.status} />
                </div>
                <div className="truncate text-sm font-medium" title={d.fileName}>{d.fileName}</div>
                <div className="truncate text-xs text-muted-foreground">{d.folderPath ?? 'Knowledge Base'}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
