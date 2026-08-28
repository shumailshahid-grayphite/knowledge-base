'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ConfusionMatrix, EvalResult, ThresholdSimRow } from '@kb/shared';
import { useAuth } from '@/lib/auth';
import { isAdminRole } from '@/lib/gaps';
import { useRun, simulateThresholds, pct } from '@/lib/eval';
import { Badge } from '@/components/ui/badge';

const DEFAULT_CANDIDATES = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { user } = useAuth();
  const [live, setLive] = useState(true);
  const { detail } = useRun(runId, live);
  const [sim, setSim] = useState<ThresholdSimRow[] | null>(null);
  const [candidates, setCandidates] = useState(DEFAULT_CANDIDATES.join(', '));

  const status = detail?.run.status;
  useEffect(() => {
    if (status === 'completed' || status === 'failed') setLive(false);
  }, [status]);

  if (user && !isAdminRole(user.role)) {
    return <p className="text-sm text-muted-foreground">You don’t have access to Evaluation.</p>;
  }
  if (!detail) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const { run, results } = detail;
  const m = run.summaryMetrics;
  const failures = results.filter(isFailure);
  const passes = results.filter((r) => !isFailure(r));

  async function runSim() {
    const scores = candidates.split(',').map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
    if (scores.length) setSim(await simulateThresholds(runId, scores));
  }

  return (
    <div className="space-y-6">
      <Link href={`/evaluation/${run.datasetId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Dataset
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Evaluation run</h1>
        <Badge variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'destructive' : 'secondary'}>{run.status}</Badge>
        <span className="text-sm text-muted-foreground">
          {run.succeededCases}/{run.totalCases} evaluated{run.erroredCases > 0 && ` · ${run.erroredCases} errored`}
        </span>
      </div>

      {run.status === 'running' && <p className="text-sm text-muted-foreground">Running… this refreshes automatically.</p>}
      {run.error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{run.error}</p>}

      {m && (
        <>
          {/* Headline metrics */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Panel title="Retrieval">
              <Row label="Recall@1" value={pct(m.retrieval.recallAt1)} />
              <Row label="Recall@3" value={pct(m.retrieval.recallAt3)} />
              <Row label="Recall@5" value={pct(m.retrieval.recallAt5)} />
              <Row label="MRR" value={m.retrieval.mrr.toFixed(2)} />
              <div className="mt-1 text-xs text-muted-foreground">{m.retrieval.casesWithExpectedDocs} cases with expected docs</div>
            </Panel>
            <Panel title="Answerability">
              <Row label="Accuracy" value={pct(m.answerability.accuracy)} />
              <Row label="Precision" value={pct(m.answerability.precision)} />
              <Row label="Recall" value={pct(m.answerability.recall)} />
              <Confusion c={m.answerability} />
            </Panel>
            <Panel title="Knowledge gaps">
              <Row label="Precision" value={pct(m.gap.confusion.precision)} />
              <Row label="Recall" value={pct(m.gap.confusion.recall)} />
              <Row label="False positives" value={String(m.gap.confusion.falsePositive)} />
              <Row label="False negatives" value={String(m.gap.confusion.falseNegative)} />
              <div className="mt-1 text-xs text-muted-foreground">no-evidence {m.gap.byReason.no_relevant_knowledge} · weak {m.gap.byReason.weak_evidence}</div>
            </Panel>
          </div>

          {/* Threshold calibration */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium">Adequacy threshold calibration</h2>
                <p className="text-xs text-muted-foreground">Recomputed from preserved scores — no re-run, and this run’s stored results are untouched.</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <input value={candidates} onChange={(e) => setCandidates(e.target.value)} className="min-w-0 flex-1 rounded-md border px-3 py-1.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <button onClick={runSim} className="rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Simulate</button>
            </div>
            {sim && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Adequacy</th>
                      <th className="py-1.5 pr-4 font-medium">Gap precision</th>
                      <th className="py-1.5 pr-4 font-medium">Gap recall</th>
                      <th className="py-1.5 pr-4 font-medium">False pos</th>
                      <th className="py-1.5 pr-4 font-medium">False neg</th>
                      <th className="py-1.5 font-medium">Answer accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.map((r) => (
                      <tr key={r.adequacyScore} className="border-t">
                        <td className="py-1.5 pr-4 font-mono">{r.adequacyScore.toFixed(2)}</td>
                        <td className="py-1.5 pr-4">{pct(r.gap.confusion.precision)}</td>
                        <td className="py-1.5 pr-4">{pct(r.gap.confusion.recall)}</td>
                        <td className="py-1.5 pr-4">{r.gap.confusion.falsePositive}</td>
                        <td className="py-1.5 pr-4">{r.gap.confusion.falseNegative}</td>
                        <td className="py-1.5">{pct(r.answerability.accuracy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Failures first */}
      <div>
        <h2 className="mb-2 text-sm font-medium">Failures {failures.length > 0 && <span className="text-muted-foreground">({failures.length})</span>}</h2>
        {failures.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No failures on this run.</p>
        ) : (
          <div className="space-y-2">{failures.map((r) => <ResultCard key={r.id} r={r} />)}</div>
        )}
      </div>

      {passes.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">{passes.length} passing cases</summary>
          <div className="mt-2 space-y-2">{passes.map((r) => <ResultCard key={r.id} r={r} />)}</div>
        </details>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Config snapshot</summary>
        <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">{JSON.stringify(run.configSnapshot, null, 2)}</pre>
      </details>
    </div>
  );
}

function isFailure(r: EvalResult): boolean {
  if (r.error) return true;
  if (r.expectedDocuments.length > 0 && !r.expectedDocumentFound) return true;
  if (r.expectedGap !== r.actualGap) return true;
  return r.expectedAnswerable !== r.actualAnswerable;
}

function ResultCard({ r }: { r: EvalResult }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="font-medium">{r.question}</div>
      {r.error ? (
        <div className="mt-1 text-xs text-destructive">Errored: {r.error}</div>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Answerable" ok={r.expectedAnswerable === r.actualAnswerable} expected={String(r.expectedAnswerable)} actual={String(r.actualAnswerable)} />
          <Field label="Knowledge gap" ok={r.expectedGap === r.actualGap} expected={String(r.expectedGap)} actual={`${r.actualGap}${r.gapReason ? ` (${r.gapReason.replace(/_/g, ' ')})` : ''}`} />
          {r.expectedDocuments.length > 0 && (
            <Field
              label="Expected doc"
              ok={!!r.expectedDocumentFound}
              expected={r.expectedDocuments.map((d) => d.documentName).join(', ')}
              actual={r.expectedDocumentBestRank ? `found at rank ${r.expectedDocumentBestRank}` : 'not retrieved'}
            />
          )}
          <Field label="Top score" ok expected="" actual={r.topScore == null ? '—' : r.topScore.toFixed(3)} />
        </div>
      )}
      {r.ranked.length > 0 && (
        <div className="mt-2 overflow-x-auto text-xs text-muted-foreground">
          <span className="font-medium">Ranking: </span>
          {r.ranked.slice(0, 5).map((d, i) => (
            <span key={d.documentId}>{i > 0 && ' › '}{d.documentName} ({d.rerankScore.toFixed(2)})</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, ok, expected, actual }: { label: string; ok: boolean; expected: string; actual: string }) {
  return (
    <div className={`rounded-md border-l-2 pl-2 ${ok ? 'border-green-600/40' : 'border-destructive/60'}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {expected && <div className="text-xs">expected: {expected}</div>}
      <div className="text-xs">actual: {actual}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
function Confusion({ c }: { c: ConfusionMatrix }) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
      <span>TP {c.truePositive}</span><span>FP {c.falsePositive}</span>
      <span>FN {c.falseNegative}</span><span>TN {c.trueNegative}</span>
    </div>
  );
}
