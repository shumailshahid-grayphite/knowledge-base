'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { GapStatus } from '@kb/shared';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useKnowledgeGap, updateGapStatus, isAdminRole } from '@/lib/gaps';
import { useDatasets, createCase } from '@/lib/eval';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { GapStatusBadge } from '@/components/gap-status-badge';

export default function KnowledgeGapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { gap, isLoading, mutate } = useKnowledgeGap(id);
  const [addOpen, setAddOpen] = useState(false);

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
          <button onClick={() => setAddOpen(true)} className="rounded-full border px-4 py-1.5 text-sm font-medium hover:bg-accent">
            Add to evaluation
          </button>
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

      {addOpen && <AddToEvalModal question={gap.title} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

/**
 * Turn a real gap into a regression case. The admin's judgement is the label:
 * a genuine gap -> expected gap = yes; a false positive -> expected gap = no.
 * Never derived from resolve/ignore (those don't mean the same thing).
 */
function AddToEvalModal({ question, onClose }: { question: string; onClose: () => void }) {
  const { datasets } = useDatasets();
  const [datasetId, setDatasetId] = useState('');
  const [isRealGap, setIsRealGap] = useState(true);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!datasetId || busy) return;
    setBusy(true);
    try {
      await createCase(datasetId, {
        question,
        expectedAnswerable: !isRealGap, // a real gap is NOT answerable from the KB
        expectedGap: isRealGap,
        expectedDocuments: [],
      });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-base font-medium">Add to evaluation</div>
        <p className="mb-3 text-xs text-muted-foreground">Create a labelled regression case from this question.</p>
        <div className="mb-3 rounded-md border bg-muted/30 p-2 text-sm">{question}</div>

        {saved ? (
          <p className="text-sm text-green-600">Added. Future runs will check this case.</p>
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Dataset</label>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm">
              <option value="">Select a dataset…</option>
              {datasets?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div className="mb-4 flex gap-2 text-sm">
              <button onClick={() => setIsRealGap(true)} className={`flex-1 rounded-md border px-3 py-2 ${isRealGap ? 'border-primary bg-primary/10 font-medium' : ''}`}>
                Real gap
              </button>
              <button onClick={() => setIsRealGap(false)} className={`flex-1 rounded-md border px-3 py-2 ${!isRealGap ? 'border-primary bg-primary/10 font-medium' : ''}`}>
                False positive
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-full px-4 py-1.5 text-sm hover:bg-accent">Cancel</button>
              <button onClick={save} disabled={!datasetId || busy} className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                Add case
              </button>
            </div>
            {datasets && datasets.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No datasets yet — create one under Evaluation first.</p>}
          </>
        )}
      </div>
    </div>
  );
}
