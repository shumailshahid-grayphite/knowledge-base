'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import type { DocumentResponse, SpaceResponse } from '@kb/shared';
import { API_BASE, apiFetch, fetcher, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/utils';

const ACTIVE = new Set(['uploaded', 'queued', 'processing']);

export default function SpaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: space } = useSWR<SpaceResponse>(`/spaces/${id}`, fetcher);
  const docsKey = `/spaces/${id}/documents`;
  const { data: docs } = useSWR<DocumentResponse[]>(docsKey, fetcher, {
    // Poll while anything is still processing.
    refreshInterval: (latest) => (latest?.some((d) => ACTIVE.has(d.status)) ? 3000 : 0),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/spaces/${id}/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
        body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Upload failed (${res.status})`);
      if (fileRef.current) fileRef.current.value = '';
      await mutate(docsKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function reprocess(docId: string) {
    await apiFetch(`/documents/${docId}/reprocess`, { method: 'POST' });
    await mutate(docsKey);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{space?.name ?? 'Space'}</h1>
          <p className="text-muted-foreground">{space?.description || 'Documents and knowledge for this space.'}</p>
        </div>
        <Link href={`/spaces/${id}/ask`}>
          <Button>Ask this space</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload document</CardTitle>
          <CardDescription>PDF, DOCX, TXT, or Markdown. Processing runs in the background.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.markdown"
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          />
          <Button onClick={upload} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </CardContent>
        {error && <CardContent className="pt-0 text-sm text-destructive">{error}</CardContent>}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
          <CardDescription>Status updates automatically while processing.</CardDescription>
        </CardHeader>
        <CardContent>
          {!docs && <p className="text-muted-foreground">Loading…</p>}
          {docs && docs.length === 0 && <p className="text-muted-foreground">No documents yet.</p>}
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
