'use client';

import Link from 'next/link';
import { useState } from 'react';
import { mutate } from 'swr';
import { Folder, FolderPlus } from 'lucide-react';
import type { FolderResponse } from '@kb/shared';
import { apiFetch, ApiError } from '@/lib/api';
import { useDefaultSpace, useFolders } from '@/lib/kb';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function KnowledgeBasePage() {
  const { space, spaceId } = useDefaultSpace();
  const { folders, isLoading } = useFolders(spaceId);

  const topLevel = folders?.filter((f) => f.parentId === null) ?? [];
  const childCount = (id: string) => folders?.filter((f) => f.parentId === id).length ?? 0;

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createFolder() {
    const trimmed = name.trim();
    if (!trimmed || !spaceId) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/spaces/${spaceId}/folders`, {
        method: 'POST',
        body: JSON.stringify({ name: trimmed }),
      });
      setName('');
      await mutate(`/spaces/${spaceId}/folders`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create folder');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        <p className="text-muted-foreground">
          Organize documents into folders. Upload files or connect a source, then ask across everything.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Folders</CardDescription>
            <CardTitle className="text-3xl">{folders?.length ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Documents</CardDescription>
            <CardTitle className="text-3xl">{space?.documentCount ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New folder</CardTitle>
          <CardDescription>Top-level folders like HR, Finance, or Legal. Add subfolders inside them.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            className="max-w-xs"
            onKeyDown={(e) => e.key === 'Enter' && createFolder()}
          />
          <Button onClick={createFolder} disabled={busy || !name.trim() || !spaceId}>
            <FolderPlus className="h-4 w-4" /> {busy ? 'Creating…' : 'Create'}
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Folders</h2>
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {folders && topLevel.length === 0 && (
          <p className="text-muted-foreground">No folders yet. Create one above to get started.</p>
        )}
        <div className="grid grid-cols-2 gap-4">
          {topLevel.map((f: FolderResponse) => (
            <Link key={f.id} href={`/folders/${f.id}`}>
              <Card className="transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Folder className="h-4 w-4" /> {f.name}
                  </CardTitle>
                  <CardDescription>
                    {f.documentCount} document(s)
                    {childCount(f.id) > 0 && ` · ${childCount(f.id)} subfolder(s)`}
                    {f.origin === 'connector' && ' · synced'}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
