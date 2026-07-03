'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import type { RemoteNode } from '@kb/shared';
import { apiFetch, fetcher } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export default function ConnectorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [path, setPath] = useState<Crumb[]>([{ name: 'Sources' }]);
  const [selected, setSelected] = useState<Record<string, string>>({}); // id -> name
  const [msg, setMsg] = useState<string | null>(null);

  const current = path[path.length - 1]!;
  const browseKey = `/connectors/${id}/browse${current.id ? `?nodeId=${encodeURIComponent(current.id)}` : ''}`;
  const { data: nodes, error: browseError, isLoading } = useSWR<RemoteNode[]>(browseKey, fetcher);

  const historyKey = `/connectors/${id}/sync-history`;
  const { data: history } = useSWR<SyncRow[]>(historyKey, fetcher, {
    refreshInterval: (rows) => (rows?.some((r) => ACTIVE.has(r.status)) ? 3000 : 0),
  });

  function drillInto(node: RemoteNode) {
    setPath((p) => [...p, { id: node.id, name: node.name }]);
  }
  function goto(index: number) {
    setPath((p) => p.slice(0, index + 1));
  }
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Connection</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Choose folders to sync</CardTitle>
          <CardDescription>Browse into folders and select the ones to ingest.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {path.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">/</span>}
                <button className="hover:underline" onClick={() => goto(i)}>
                  {c.name}
                </button>
              </span>
            ))}
          </div>

          {browseError && (
            <p className="text-sm text-destructive">
              Could not browse (OAuth credentials required): {String((browseError as Error).message)}
            </p>
          )}
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {nodes && nodes.length === 0 && <p className="text-muted-foreground">No folders here.</p>}

          <div className="divide-y">
            {nodes?.map((n) => (
              <div key={n.id} className="flex items-center justify-between py-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!selected[n.id]} onChange={() => toggle(n)} />
                  <span className="font-medium">{n.name}</span>
                  <Badge variant="outline">{n.type}</Badge>
                </label>
                {(n.type === 'folder' || n.type === 'site' || n.type === 'drive') && (
                  <Button variant="ghost" size="sm" onClick={() => drillInto(n)}>
                    Open
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={syncSelected} disabled={Object.keys(selected).length === 0}>
              Sync {Object.keys(selected).length || ''} selected
            </Button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync history</CardTitle>
        </CardHeader>
        <CardContent>
          {history && history.length === 0 && <p className="text-muted-foreground">No syncs yet.</p>}
          <div className="divide-y">
            {history?.map((h) => (
              <div key={h.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{formatDate(h.createdAt)}</div>
                  <div className="text-xs text-muted-foreground">
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
        </CardContent>
      </Card>
    </div>
  );
}
