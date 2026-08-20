'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Cloud, Plug } from 'lucide-react';
import { apiFetch, fetcher } from '@/lib/api';
import { useDefaultSpace } from '@/lib/kb';
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

const typeLabel = (t: string) => PROVIDERS.find((p) => p.type === t)?.label ?? t;

export default function ConnectorsPage() {
  const { spaceId } = useDefaultSpace();
  const { data: connectors } = useSWR<ConnectorRow[]>('/connectors', fetcher);
  const [error, setError] = useState<string | null>(null);

  const connectedTypes = new Set(connectors?.map((c) => c.type));

  async function connect(type: string) {
    setError(null);
    if (!spaceId) return;
    try {
      const { url } = await apiFetch<{ url: string }>(`/connectors/${type}/auth-url?spaceId=${spaceId}`);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start OAuth');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connected sources</h1>
        <p className="text-sm text-muted-foreground">
          Connect Google Drive or SharePoint to mirror their folders into your knowledge base.
        </p>
      </div>

      {/* Add a source */}
      <section>
        <h2 className="mb-2 text-sm font-medium">Add a source</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((p) => {
            const connected = connectedTypes.has(p.type);
            return (
              <button
                key={p.type}
                onClick={() => connect(p.type)}
                className="group flex items-center gap-3 rounded-lg border bg-background px-4 py-3 text-left transition hover:bg-accent/40 hover:shadow-sm"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted">
                  <Cloud className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {connected ? 'Connected · click to reconnect' : 'Connect & sync folders'}
                  </div>
                </div>
                {connected && <Badge variant="success" className="shrink-0">Connected</Badge>}
              </button>
            );
          })}
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          Requires OAuth app credentials configured on the API (Google / Azure).
        </p>
      </section>

      {/* Your connections */}
      <section>
        <h2 className="mb-2 text-sm font-medium">Your connections</h2>
        {connectors && connectors.length === 0 && (
          <div className="grid h-32 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <Plug className="h-6 w-6" />
              No sources connected yet.
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectors?.map((c) => (
            <Link
              key={c.id}
              href={`/connectors/${c.id}`}
              className="group flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 hover:bg-muted"
            >
              <Cloud className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {typeLabel(c.type)} · connected {formatDate(c.createdAt)}
                </div>
              </div>
              <Badge variant={c.status === 'active' ? 'success' : 'secondary'}>{c.status}</Badge>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
