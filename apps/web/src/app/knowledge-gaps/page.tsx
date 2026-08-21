'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import type { GapStatus } from '@kb/shared';
import { useAuth } from '@/lib/auth';
import { useKnowledgeGaps, useGapMetrics, updateGapStatus, isAdminRole } from '@/lib/gaps';
import { GapStatusBadge } from '@/components/gap-status-badge';
import { cn, formatDate } from '@/lib/utils';

const FILTERS: { label: string; value?: GapStatus }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Ignored', value: 'ignored' },
  { label: 'All', value: undefined },
];

export default function KnowledgeGapsPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<GapStatus | undefined>('open');
  const { gaps, isLoading, mutate } = useKnowledgeGaps(filter);
  const { metrics } = useGapMetrics(isAdminRole(user?.role));
  const [busyId, setBusyId] = useState<string | null>(null);

  if (user && !isAdminRole(user.role)) {
    return <p className="text-sm text-muted-foreground">You don’t have access to Knowledge Gaps.</p>;
  }

  async function setStatus(id: string, status: GapStatus) {
    setBusyId(id);
    try {
      await updateGapStatus(id, status);
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Lightbulb className="h-5 w-5 text-primary" /> Knowledge Gaps
        </h1>
        <p className="text-sm text-muted-foreground">
          Potential gaps — recurring questions your knowledge base couldn’t confidently answer. A weak
          or missing match doesn’t prove the information doesn’t exist; it’s a signal worth reviewing.
        </p>
      </div>

      {/* Measurement */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="KB questions" value={metrics.totalQuestions} />
          <Stat
            label="Gap-signal rate"
            value={`${Math.round(metrics.gapSignalRate * 100)}%`}
            hint={`${metrics.gapSignals} of ${metrics.totalQuestions}`}
          />
          <Stat
            label="Recurring gaps"
            value={metrics.recurringGaps}
            hint={`${metrics.openGaps} open`}
          />
          <Stat
            label="No evidence / weak"
            value={`${metrics.signalsByReason.no_relevant_knowledge} / ${metrics.signalsByReason.weak_evidence}`}
          />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={cn(
              'border-b-2 px-3 py-1.5 text-sm transition-colors',
              filter === f.value
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : gaps && gaps.length > 0 ? (
        <div className="space-y-2">
          {gaps.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-lg border p-4">
              <Link href={`/knowledge-gaps/${g.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium">{g.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Asked {g.occurrenceCount}×
                  {g.distinctUsers > 0 && ` · ${g.distinctUsers} ${g.distinctUsers === 1 ? 'person' : 'people'}`}
                  {' · '}last {formatDate(g.lastSeenAt)}
                </div>
              </Link>
              <GapStatusBadge status={g.status} />
              {g.status !== 'resolved' && (
                <button
                  onClick={() => setStatus(g.id, 'resolved')}
                  disabled={busyId === g.id}
                  className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  Resolve
                </button>
              )}
              {g.status !== 'ignored' && (
                <button
                  onClick={() => setStatus(g.id, 'ignored')}
                  disabled={busyId === g.id}
                  className="rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  Ignore
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid h-32 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Lightbulb className="h-6 w-6" />
            No {filter ?? ''} knowledge gaps.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
