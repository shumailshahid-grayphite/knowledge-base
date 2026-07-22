'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { ChevronRight, Cloud, Folder } from 'lucide-react';
import type { RemoteNode } from '@kb/shared';
import { apiFetch, fetcher } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';

interface Crumb {
  id?: string;
  name: string;
}

interface SyncRow {
  id: string;
  status: string;
  stats: Record<string, number>;
  error: string | null;
  createdAt: string;
}

const ACTIVE = new Set(['queued', 'running']);
const isContainer = (t: string) => t === 'folder' || t === 'site' || t === 'drive';

export default function ConnectorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [path, setPath] = useState<Crumb[]>([{ name: 'Root' }]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const current = path[path.length - 1]!;
  const browseKey = `/connectors/${id}/browse${current.id ? `?nodeId=${encodeURIComponent(current.id)}` : ''}`;
  const { data: nodes, error: browseError, isLoading } = useSWR<RemoteNode[]>(browseKey, fetcher);

  const historyKey = `/connectors/${id}/sync-history`;
  const { data: history } = useSWR<SyncRow[]>(historyKey, fetcher, {
    refreshInterval: (rows) => (rows?.some((r) => ACTIVE.has(r.status)) ? 3000 : 0),
  });

  const drillInto = (node: RemoteNode) => setPath((p) => [...p, { id: node.id, name: node.name }]);
  const goto = (index: number) => setPath((p) => p.slice(0, index + 1));
  function toggle(node: RemoteNode) {
    setSelected((s) => {
      const next = { ...s };
      if (next[node.id]) delete next[node.id];
      else next[node.id] = node.name;
      return next;
    });
  }

  async function syncSelected() {
    const folderIds = Object.keys(selected);
    if (folderIds.length === 0) return;
    setMsg(null);
    try {
      await apiFetch(`/connectors/${id}/sync`, {
        method: 'POST',
        body: JSON.stringify({ selector: { folderIds } }),
      });
      setSelected({});
      setMsg('Sync started.');
      await mutate(historyKey);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Sync failed to start');
    }
  }

  const count = Object.keys(selected).length;

  return (
    <div className="space-y-5">
      {/* Header / breadcrumb back to sources */}
      <div className="flex items-center gap-1 text-xl">
        <Link href="/connectors" className="font-semibold text-muted-foreground hover:underline">
          Connected sources
        </Link>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
        <span className="font-semibold">Choose folders to sync</span>
      </div>

      <section>
        {/* Remote path breadcrumb */}
        <div className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {path.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
              <button className="hover:underline" onClick={() => goto(i)}>
                {c.name}
              </button>
            </span>
          ))}
        </div>

        {browseError && (
          <p className="mb-2 text-sm text-destructive">
            Could not browse (OAuth credentials required): {String((browseError as Error).message)}
          </p>
        )}

        <div className="overflow-hidden rounded-xl border">
          {isLoading && <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
          {nodes && nodes.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No items here.</p>}
          {nodes?.map((n) => (
            <div key={n.id} className="group flex items-center justify-between gap-2 border-b px-4 py-2.5 last:border-0 hover:bg-accent/40">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={!!selected[n.id]}
                  onChange={() => toggle(n)}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                {isContainer(n.type) ? (
                  <Folder className="h-5 w-5 shrink-0 fill-muted-foreground/30 text-muted-foreground" />
                ) : (
                  <Cloud className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm">{n.name}</span>
                <Badge variant="outline" className="shrink-0">{n.type}</Badge>
              </label>
              {isContainer(n.type) && (
                <button
                  onClick={() => drillInto(n)}
                  className="rounded-full px-3 py-1 text-sm text-muted-foreground opacity-0 transition hover:bg-accent group-hover:opacity-100"
                >
                  Open
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={syncSelected}
            disabled={count === 0}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            Sync {count || ''} selected
          </button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </section>

      {/* Sync history */}
      <section>
        <h2 className="mb-2 text-sm font-medium">Sync history</h2>
        {history && history.length === 0 && <p className="text-sm text-muted-foreground">No syncs yet.</p>}
        {history && history.length > 0 && (
          <div className="overflow-hidden rounded-xl border">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 border-b px-4 py-2.5 text-sm last:border-0">
                <div className="min-w-0">
                  <div className="font-medium">{formatDate(h.createdAt)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {h.stats
                      ? `found ${h.stats.found ?? 0} · new ${h.stats.new ?? 0} · updated ${h.stats.updated ?? 0} · skipped ${h.stats.skipped ?? 0} · failed ${h.stats.failed ?? 0}`
                      : ''}
                    {h.error && <span className="text-destructive"> · {h.error}</span>}
                  </div>
                </div>
                <Badge variant={h.status === 'completed' ? 'success' : h.status === 'failed' ? 'destructive' : 'secondary'}>
                  {h.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
