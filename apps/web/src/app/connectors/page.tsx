'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import type { SpaceResponse } from '@kb/shared';
import { apiFetch, fetcher } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';

interface ConnectorRow {
  id: string;
  type: string;
  name: string;
  status: string;
  createdAt: string;
}

const PROVIDERS = [
  { type: 'gdrive', label: 'Google Drive' },
  { type: 'sharepoint', label: 'SharePoint' },
];

export default function ConnectorsPage() {
  const { data: spaces } = useSWR<SpaceResponse[]>('/spaces', fetcher);
  const { data: connectors } = useSWR<ConnectorRow[]>('/connectors', fetcher);
  const [spaceId, setSpaceId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const targetSpace = spaceId || spaces?.[0]?.id || '';

  async function connect(type: string) {
    setError(null);
    if (!targetSpace) {
      setError('Create a knowledge space first.');
      return;
    }
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/connectors/${type}/auth-url?spaceId=${targetSpace}`,
      );
      window.location.href = url; // redirect to provider consent
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start OAuth');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Connect Sources</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a connection</CardTitle>
          <CardDescription>Synced files are ingested into the selected knowledge space.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Target space</label>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={targetSpace}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              {spaces?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <Button key={p.type} variant="outline" onClick={() => connect(p.type)}>
                Connect {p.label}
              </Button>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">
            Requires OAuth app credentials configured on the API (Google / Azure).
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Connections</h2>
        {connectors && connectors.length === 0 && (
          <p className="text-muted-foreground">No connections yet.</p>
        )}
        {connectors?.map((c) => (
          <Link key={c.id} href={`/connectors/${c.id}`}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription>
                    {c.type} · connected {formatDate(c.createdAt)}
                  </CardDescription>
                </div>
                <Badge variant={c.status === 'active' ? 'success' : 'secondary'}>{c.status}</Badge>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
