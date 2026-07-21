'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { ChevronRight, Folder, FolderPlus } from 'lucide-react';
import type { DocumentResponse } from '@kb/shared';
import { API_BASE, apiFetch, ApiError, fetcher, getToken } from '@/lib/api';
import { useDefaultSpace, useFolders, folderTrail } from '@/lib/kb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/utils';

const ACTIVE = new Set(['uploaded', 'queued', 'processing']);

export default function FolderDetailPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const { spaceId } = useDefaultSpace();
  const { folders } = useFolders(spaceId);

  const folder = folders?.find((f) => f.id === folderId);
  const children = folders?.filter((f) => f.parentId === folderId) ?? [];
  const trail = folders ? folderTrail(folders, folderId) : [];

  const docsKey = spaceId ? `/spaces/${spaceId}/documents?folderId=${folderId}` : null;
  const { data: docs } = useSWR<DocumentResponse[]>(docsKey, fetcher, {
    refreshInterval: (latest) => (latest?.some((d) => ACTIVE.has(d.status)) ? 3000 : 0),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subName, setSubName] = useState('');
  const [subBusy, setSubBusy] = useState(false);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !spaceId) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folderId', folderId);
      const res = await fetch(`${API_BASE}/spaces/${spaceId}/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
        body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Upload failed (${res.status})`);
      if (fileRef.current) fileRef.current.value = '';
      await mutate(docsKey);
      await mutate(`/spaces/${spaceId}/folders`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function createSubfolder() {
    const trimmed = subName.trim();
    if (!trimmed || !spaceId) return;
    setSubBusy(true);
    try {
      await apiFetch(`/spaces/${spaceId}/folders`, {
        method: 'POST',
        body: JSON.stringify({ name: trimmed, parentId: folderId }),
      });
      setSubName('');
      await mutate(`/spaces/${spaceId}/folders`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create subfolder');
    } finally {
      setSubBusy(false);
    }
  }

  async function reprocess(docId: string) {
    await apiFetch(`/documents/${docId}/reprocess`, { method: 'POST' });
    await mutate(docsKey);
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">Knowledge Base</Link>
        {trail.map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" />
            {f.id === folderId ? (
              <span className="font-medium text-foreground">{f.name}</span>
            ) : (
              <Link href={`/folders/${f.id}`} className="hover:underline">{f.name}</Link>
            )}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Folder className="h-6 w-6" /> {folder?.name ?? 'Folder'}
        </h1>
        <Link href={`/ask?folderId=${folderId}`}>
          <Button variant="outline">Ask this folder</Button>
        </Link>
      </div>

      {/* Subfolders */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subfolders</CardTitle>
          <CardDescription>Nest folders to mirror how your documents are organized.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              placeholder="New subfolder name"
              className="max-w-xs"
              onKeyDown={(e) => e.key === 'Enter' && createSubfolder()}
            />
            <Button variant="outline" size="sm" onClick={createSubfolder} disabled={subBusy || !subName.trim()}>
              <FolderPlus className="h-4 w-4" /> Add
            </Button>
          </div>
          {children.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {children.map((c) => (
                <Link
                  key={c.id}
                  href={`/folders/${c.id}`}
                  className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent/40"
                >
                  <Folder className="h-4 w-4" /> {c.name}
                  <span className="text-xs text-muted-foreground">{c.documentCount}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload to this folder</CardTitle>
          <CardDescription>PDF, DOCX, TXT, or Markdown. Processing runs in the background.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.markdown"
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          />
          <Button onClick={upload} disabled={uploading || !spaceId}>
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </CardContent>
        {error && <CardContent className="pt-0 text-sm text-destructive">{error}</CardContent>}
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
          <CardDescription>Files directly in this folder. Status updates automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          {!docs && <p className="text-muted-foreground">Loading…</p>}
          {docs && docs.length === 0 && <p className="text-muted-foreground">No documents in this folder yet.</p>}
          <div className="divide-y">
            {docs?.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{d.fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.mimeType} · {formatDate(d.createdAt)}
                    {d.errorMessage && <span className="text-destructive"> · {d.errorMessage}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} />
                  {(d.status === 'failed' || d.status === 'completed' || d.status === 'needs_review') && (
                    <Button variant="outline" size="sm" onClick={() => reprocess(d.id)}>
                      Reprocess
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
