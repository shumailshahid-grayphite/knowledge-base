'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { GapStatus } from '@kb/shared';
import { useAuth } from '@/lib/auth';
import { useKnowledgeGap, updateGapStatus, isAdminRole } from '@/lib/gaps';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { GapStatusBadge } from '@/components/gap-status-badge';

export default function KnowledgeGapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { gap, isLoading, mutate } = useKnowledgeGap(id);

  if (user && !isAdminRole(user.role)) {
    return <p className="text-sm text-muted-foreground">You don’t have access to Knowledge Gaps.</p>;
  }

  async function setStatus(status: GapStatus) {
    await updateGapStatus(id, status);
    await mutate();
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!gap) return <p className="text-sm text-muted-foreground">Gap not found.</p>;

  return (
    <div className="space-y-6">
      <button onClick={() => router.push('/knowledge-gaps')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Knowledge Gaps
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{gap.title}</h1>
            <GapStatusBadge status={gap.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Potential knowledge gap · asked {gap.occurrenceCount}×
            {gap.distinctUsers > 0 && ` by ${gap.distinctUsers} ${gap.distinctUsers === 1 ? 'person' : 'people'}`}
            {' · '}first {formatDate(gap.firstSeenAt)} · last {formatDate(gap.lastSeenAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {gap.status !== 'resolved' && (
            <button onClick={() => setStatus('resolved')} className="rounded-full border px-4 py-1.5 text-sm font-medium hover:bg-accent">
              Resolve
            </button>
          )}
          {gap.status !== 'ignored' && (
            <button onClick={() => setStatus('ignored')} className="rounded-full px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              Ignore
            </button>
          )}
          {gap.status !== 'open' && (
            <button onClick={() => setStatus('open')} className="rounded-full px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              Reopen
            </button>
          )}
        </div>
      </div>

      {/* Why we flagged it */}
      <div className="rounded-lg border p-4">
        <div className="text-sm font-medium">Why this was flagged</div>
        <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{gap.reasonBreakdown.no_relevant_knowledge}</span> with no
            relevant company knowledge
          </span>
          <span>
            <span className="font-medium text-foreground">{gap.reasonBreakdown.weak_evidence}</span> with only weak
            matches
          </span>
        </div>
      </div>

      {/* Sample questions */}
      <div>
        <h2 className="mb-2 text-sm font-medium">Sample questions</h2>
        <div className="space-y-2">
          {gap.signals.map((s) => (
            <div key={s.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm">{s.question}</div>
                  {s.standaloneQuestion !== s.question && (
                    <div className="mt-0.5 text-xs text-muted-foreground">Interpreted as: {s.standaloneQuestion}</div>
                  )}
                </div>
                <Badge variant="outline" className="shrink-0">
                  {s.reason === 'no_relevant_knowledge' ? 'no match' : 'weak match'}
                </Badge>
              </div>
              {s.weakMatches.length > 0 && (
                <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                  Closest documents:{' '}
                  {s.weakMatches.map((w, i) => (
                    <span key={i}>
                      {i > 0 && ', '}
                      {w.documentName} ({w.score.toFixed(2)})
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">{formatDate(s.createdAt)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
