'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Check, Play, Plus, Trash2, X } from 'lucide-react';
import type { EvalCase, ExpectedDocument, UpsertCaseRequest } from '@kb/shared';
import { useAuth } from '@/lib/auth';
import { isAdminRole } from '@/lib/gaps';
import { useDataset, useRuns, createCase, updateCase, deleteCase, startRun, searchDocuments } from '@/lib/eval';
import { Badge } from '@/components/ui/badge';
import { cn, formatDate } from '@/lib/utils';

export default function DatasetPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { dataset, mutate, isLoading } = useDataset(datasetId);
  const { runs, mutate: mutateRuns } = useRuns(datasetId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  if (user && !isAdminRole(user.role)) {
    return <p className="text-sm text-muted-foreground">You don’t have access to Evaluation.</p>;
  }

  async function run() {
    setRunning(true);
    try {
      const r = await startRun(datasetId);
      await mutateRuns();
      router.push(`/evaluation/runs/${r.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not start run');
    } finally {
      setRunning(false);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!dataset) return <p className="text-sm text-muted-foreground">Dataset not found.</p>;

  return (
    <div className="space-y-6">
      <Link href="/evaluation" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Datasets
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{dataset.name}</h1>
          <p className="text-sm text-muted-foreground">{dataset.cases.length} labelled {dataset.cases.length === 1 ? 'case' : 'cases'}</p>
        </div>
        <button
          onClick={run}
          disabled={running || dataset.cases.length === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Play className="h-4 w-4" /> {running ? 'Starting…' : 'Run evaluation'}
        </button>
      </div>

      {/* Runs */}
      {runs && runs.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Runs</h2>
          <div className="space-y-1.5">
            {runs.map((r) => (
              <Link key={r.id} href={`/evaluation/runs/${r.id}`} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent/40">
                <Badge variant={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'destructive' : 'secondary'}>{r.status}</Badge>
                <span className="text-muted-foreground">{formatDate(r.createdAt)}</span>
                {r.summaryMetrics && (
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    R@3 {Math.round(r.summaryMetrics.retrieval.recallAt3 * 100)}% · gap P {Math.round(r.summaryMetrics.gap.confusion.precision * 100)}%
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Cases */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Cases</h2>
          <button onClick={() => { setAdding(true); setEditing(null); }} className="flex items-center gap-1 text-sm text-primary hover:underline">
            <Plus className="h-4 w-4" /> Add case
          </button>
        </div>

        {adding && (
          <CaseForm
            onCancel={() => setAdding(false)}
            onSave={async (body) => { await createCase(datasetId, body); setAdding(false); await mutate(); }}
          />
        )}

        <div className="mt-2 space-y-2">
          {dataset.cases.map((c) =>
            editing === c.id ? (
              <CaseForm
                key={c.id}
                initial={c}
                onCancel={() => setEditing(null)}
                onSave={async (body) => { await updateCase(c.id, body); setEditing(null); await mutate(); }}
              />
            ) : (
              <div key={c.id} className="flex items-start gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{c.question}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant={c.expectedAnswerable ? 'secondary' : 'outline'}>{c.expectedAnswerable ? 'answerable' : 'not answerable'}</Badge>
                    {c.expectedGap && <Badge variant="outline">expected gap</Badge>}
                    {c.expectedDocuments.map((d) => (
                      <span key={d.documentId} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {d.relevance === 'primary' ? '★' : '○'} {d.documentName}
                      </span>
                    ))}
                  </div>
                </div>
                <button onClick={() => { setEditing(c.id); setAdding(false); }} className="text-xs text-muted-foreground hover:text-foreground">Edit</button>
                <button onClick={async () => { await deleteCase(c.id); await mutate(); }} className="text-muted-foreground hover:text-destructive" title="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          )}
          {dataset.cases.length === 0 && !adding && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No cases yet. Add labelled questions to evaluate.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CaseForm({ initial, onCancel, onSave }: { initial?: EvalCase; onCancel: () => void; onSave: (b: UpsertCaseRequest) => Promise<void> }) {
  const [question, setQuestion] = useState(initial?.question ?? '');
  const [answerable, setAnswerable] = useState(initial?.expectedAnswerable ?? true);
  const [gap, setGap] = useState(initial?.expectedGap ?? false);
  const [docs, setDocs] = useState<ExpectedDocument[]>(initial?.expectedDocuments ?? []);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!question.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({
        question: question.trim(),
        expectedAnswerable: answerable,
        expectedGap: gap,
        expectedDocuments: docs.map((d) => ({ documentId: d.documentId, relevance: d.relevance })),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <textarea
        autoFocus
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        placeholder="Question — e.g. What is our maternity leave policy?"
        className="w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap gap-4 text-sm">
        <Toggle label="Answerable from KB" value={answerable} onChange={setAnswerable} />
        <Toggle label="Expected knowledge gap" value={gap} onChange={setGap} />
      </div>
      <DocPicker docs={docs} onChange={setDocs} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-full px-3 py-1.5 text-sm hover:bg-accent"><X className="h-4 w-4" /></button>
        <button onClick={save} disabled={!question.trim() || busy} className="flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          <Check className="h-4 w-4" /> Save
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex items-center gap-2">
      <span className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', value ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all', value ? 'left-3.5' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

function DocPicker({ docs, onChange }: { docs: ExpectedDocument[]; onChange: (d: ExpectedDocument[]) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ documentId: string; documentName: string }[]>([]);
  const [open, setOpen] = useState(false);

  async function search(term: string) {
    setQ(term);
    if (!term.trim()) { setResults([]); return; }
    try {
      setResults(await searchDocuments(term));
      setOpen(true);
    } catch { /* ignore */ }
  }

  function add(d: { documentId: string; documentName: string }) {
    if (!docs.some((x) => x.documentId === d.documentId)) {
      onChange([...docs, { ...d, relevance: 'primary' }]);
    }
    setQ('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">Expected documents (optional)</div>
      <div className="flex flex-wrap gap-1.5">
        {docs.map((d) => (
          <span key={d.documentId} className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs">
            <button
              onClick={() => onChange(docs.map((x) => x.documentId === d.documentId ? { ...x, relevance: x.relevance === 'primary' ? 'acceptable' : 'primary' } : x))}
              title="Toggle primary / acceptable"
            >
              {d.relevance === 'primary' ? '★' : '○'}
            </button>
            {d.documentName}
            <button onClick={() => onChange(docs.filter((x) => x.documentId !== d.documentId))} className="hover:text-destructive"><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <div className="relative mt-1.5">
        <input
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder="Search documents to add…"
          className="w-full rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {open && results.length > 0 && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-background p-1 shadow-lg">
              {results.map((r) => (
                <button key={r.documentId} onClick={() => add(r)} className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                  {r.documentName}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
