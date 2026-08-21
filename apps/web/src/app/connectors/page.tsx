'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Cloud, Plug, RefreshCw } from 'lucide-react';
import { apiFetch, fetcher } from '@/lib/api';
import { useDefaultSpace } from '@/lib/kb';
import { Badge } from '@/components/ui/badge';
import { cn, formatDate } from '@/lib/utils';

interface ConnectorConfig {
  autoSync?: boolean;
  spaceId?: string;
  lastSelector?: unknown;
}
interface ConnectorRow {
  id: string;
  type: string;
  name: string;
  status: string;
  createdAt: string;
  config?: ConnectorConfig;
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
            <ConnectionCard key={c.id} c={c} onError={setError} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ConnectionCard({ c, onError }: { c: ConnectorRow; onError: (m: string | null) => void }) {
  const [saving, setSaving] = useState(false);
  const synced = c.config?.lastSelector != null;
  const autoOn = c.config?.autoSync !== false; // default on once synced

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!synced || saving) return;
    setSaving(true);
    onError(null);
    try {
      await apiFetch(`/connectors/${c.id}/auto-sync`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !autoOn }),
      });
      await mutate('/connectors');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update auto-sync');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Link
      href={`/connectors/${c.id}`}
      className="group flex flex-col gap-2 rounded-lg bg-muted/50 px-4 py-3 hover:bg-muted"
    >
      <div className="flex items-center gap-3">
        <Cloud className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{c.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {typeLabel(c.type)} · connected {formatDate(c.createdAt)}
          </div>
        </div>
        <Badge variant={c.status === 'active' ? 'success' : 'secondary'}>{c.status}</Badge>
      </div>
      {/* Auto-sync control */}
      <div className="flex items-center justify-between border-t pt-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          {synced ? (autoOn ? 'Auto-sync on' : 'Auto-sync off') : 'Sync once to enable auto-sync'}
        </span>
        {synced && (
          <button
            onClick={toggle}
            disabled={saving}
            className={cn(
              'relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50',
              autoOn ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
            title={autoOn ? 'Turn auto-sync off' : 'Turn auto-sync on'}
          >
            <span
              className={cn(
                'absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all',
                autoOn ? 'left-3.5' : 'left-0.5',
              )}
            />
          </button>
        )}
      </div>
    </Link>
  );
}
