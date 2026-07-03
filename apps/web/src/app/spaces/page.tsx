'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import type { SpaceResponse } from '@kb/shared';
import { apiFetch, fetcher } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function SpacesPage() {
  const { data: spaces, isLoading } = useSWR<SpaceResponse[]>('/spaces', fetcher);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/spaces', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined }),
      });
      setName('');
      setDescription('');
      await mutate('/spaces');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create space');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Knowledge Spaces</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a space</CardTitle>
          <CardDescription>A space is a scoped collection agents can search.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Consulting Frameworks" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={create} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create space'}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {spaces?.map((s) => (
          <Link key={s.id} href={`/spaces/${s.id}`}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <CardDescription>{s.description || 'No description'}</CardDescription>
                </div>
                <span className="text-sm text-muted-foreground">{s.documentCount ?? 0} docs</span>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
