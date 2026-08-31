'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FlaskConical, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { isAdminRole } from '@/lib/gaps';
import { useDatasets, createDataset } from '@/lib/eval';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';

export default function EvaluationPage() {
  const { user } = useAuth();
  const { datasets, mutate } = useDatasets();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (user && !isAdminRole(user.role)) {
    return <p className="text-sm text-muted-foreground">You don’t have access to Evaluation.</p>;
  }

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createDataset(name.trim());
      setName('');
      setCreating(false);
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <FlaskConical className="h-5 w-5 text-primary" /> Evaluation
          </h1>
          <p className="text-sm text-muted-foreground">
            Build a set of real questions with the answers you expect, then check how well the assistant
            handles them. It’s a report card — so when you change something, you can see if it got better or worse.
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> New dataset
        </button>
      </div>

      {creating && (
        <div className="flex gap-2 rounded-lg border p-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Dataset name — e.g. Production RAG Baseline"
            className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button onClick={create} disabled={!name.trim() || busy} className="rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Create
          </button>
        </div>
      )}

      {datasets && datasets.length > 0 ? (
        <div className="space-y-2">
          {datasets.map((d) => (
            <Link key={d.id} href={`/evaluation/${d.id}`} className="flex items-center gap-3 rounded-lg border p-4 hover:bg-accent/40">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">
                  {d.caseCount} {d.caseCount === 1 ? 'case' : 'cases'}
                  {d.lastRunAt ? ` · last run ${formatDate(d.lastRunAt)}` : ' · never run'}
                </div>
              </div>
              {d.lastRunStatus && <Badge variant={d.lastRunStatus === 'completed' ? 'success' : d.lastRunStatus === 'failed' ? 'destructive' : 'secondary'}>{d.lastRunStatus}</Badge>}
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid h-32 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <FlaskConical className="h-6 w-6" />
            No datasets yet. Create one to start measuring retrieval quality.
          </div>
        </div>
      )}
    </div>
  );
}
