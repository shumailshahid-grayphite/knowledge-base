'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import type { EvalMetrics, EvalResult, ThresholdSimRow } from '@kb/shared';
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
        <ArrowLeft className="h-4 w-4" /> Back to dataset
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Test results</h1>
        <Badge variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'destructive' : 'secondary'}>{run.status}</Badge>
        <span className="text-sm text-muted-foreground">
          {run.succeededCases}/{run.totalCases} questions checked{run.erroredCases > 0 && ` · ${run.erroredCases} errored`}
        </span>
      </div>

      {run.status === 'running' && <p className="text-sm text-muted-foreground">Running the questions through the system… this updates automatically.</p>}
      {run.error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{run.error}</p>}

      {m && (
        <>
          {/* Plain-English summary */}
          <div className="rounded-xl border bg-muted/20 p-5">
            <div className="text-sm font-medium">In plain English</div>
            <p className="mt-1 text-[15px] leading-relaxed">{summary(m)}</p>
          </div>

          {/* Score cards — each explained */}
          <div className="grid gap-3 md:grid-cols-3">
            <ScoreCard
              title="Finding the right document"
              question="When an answer lived in a specific document, did search surface it?"
              rows={[
                { label: 'Right document was #1', value: pct(m.retrieval.recallAt1), good: m.retrieval.recallAt1 },
                { label: '…in the top 3', value: pct(m.retrieval.recallAt3), good: m.retrieval.recallAt3 },
                { label: '…in the top 5', value: pct(m.retrieval.recallAt5), good: m.retrieval.recallAt5 },
              ]}
              foot={`Based on ${m.retrieval.casesWithExpectedDocs} question${m.retrieval.casesWithExpectedDocs === 1 ? '' : 's'} with an expected source. Higher is better.`}
            />
            <ScoreCard
              title="Knowing when it can answer"
              question="Did the system correctly judge whether your docs actually cover the question?"
              rows={[{ label: 'Correct judgements', value: pct(m.answerability.accuracy), good: m.answerability.accuracy }]}
              tallies={[
                { label: 'Handled correctly', n: m.answerability.truePositive + m.answerability.trueNegative, tone: 'ok' },
                { label: 'Answered when it shouldn’t have', n: m.answerability.falsePositive, tone: 'bad' },
                { label: 'Gave up when it could have answered', n: m.answerability.falseNegative, tone: 'bad' },
              ]}
            />
            <ScoreCard
              title="Spotting missing knowledge"
              question="For questions your docs genuinely don’t cover, did it flag the gap?"
              rows={[
                { label: 'Real gaps it caught', value: `${m.gap.confusion.truePositive}/${m.gap.expectedGaps}`, good: m.gap.confusion.recall },
                { label: 'Of its flags, how many were real', value: m.gap.detectedGaps ? pct(m.gap.confusion.precision) : '—', good: m.gap.confusion.precision },
              ]}
              tallies={[
                { label: 'Missed gaps', n: m.gap.confusion.falseNegative, tone: 'bad' },
                { label: 'False alarms', n: m.gap.confusion.falsePositive, tone: 'bad' },
              ]}
            />
          </div>

          {/* Tuning */}
          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-medium">Tuning: how strict should “missing knowledge” be?</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The system flags a gap when its best match is weaker than a strictness setting. Below is what would have
              happened at different settings on <em>these same questions</em> — calculated instantly, nothing re-runs.
              A higher setting catches more gaps but risks more false alarms.
            </p>
            <div className="mt-3 flex gap-2">
              <input value={candidates} onChange={(e) => setCandidates(e.target.value)} className="min-w-0 flex-1 rounded-md border px-3 py-1.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <button onClick={runSim} className="rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Compare settings</button>
            </div>
            {sim && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Strictness</th>
                      <th className="py-1.5 pr-4 font-medium">Real gaps caught</th>
                      <th className="py-1.5 pr-4 font-medium">Flags that were real</th>
                      <th className="py-1.5 pr-4 font-medium">Missed gaps</th>
                      <th className="py-1.5 font-medium">False alarms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.map((r) => (
                      <tr key={r.adequacyScore} className="border-t">
                        <td className="py-1.5 pr-4 font-mono">{r.adequacyScore.toFixed(2)}</td>
                        <td className="py-1.5 pr-4">{pct(r.gap.confusion.recall)}</td>
                        <td className="py-1.5 pr-4">{r.gap.detectedGaps ? pct(r.gap.confusion.precision) : '—'}</td>
                        <td className="py-1.5 pr-4">{r.gap.confusion.falseNegative}</td>
                        <td className="py-1.5">{r.gap.confusion.falsePositive}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* What went wrong */}
      <div>
        <h2 className="text-sm font-medium">What went wrong {failures.length > 0 && <span className="text-muted-foreground">({failures.length})</span>}</h2>
        <p className="mb-2 text-xs text-muted-foreground">The questions the system didn’t handle as expected — the useful part to review.</p>
        {failures.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nothing went wrong on this run. 🎉</p>
        ) : (
          <div className="space-y-2">{failures.map((r) => <ResultCard key={r.id} r={r} />)}</div>
        )}
      </div>

      {passes.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">{passes.length} questions handled correctly</summary>
          <div className="mt-2 space-y-2">{passes.map((r) => <ResultCard key={r.id} r={r} />)}</div>
        </details>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Technical details (settings used for this run)</summary>
        <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">{JSON.stringify(run.configSnapshot, null, 2)}</pre>
      </details>
    </div>
  );
}

/** One friendly, human sentence describing how the run went. */
function summary(m: EvalMetrics): string {
  const parts: string[] = [`We put ${m.evaluatedCases} test question${m.evaluatedCases === 1 ? '' : 's'} through the system.`];
  if (m.retrieval.casesWithExpectedDocs > 0) {
    parts.push(`For the ${m.retrieval.casesWithExpectedDocs} with a known source document, it surfaced the right one in the top 3 results ${pct(m.retrieval.recallAt3)} of the time.`);
  }
  const answerCorrect = m.answerability.truePositive + m.answerability.trueNegative;
  parts.push(`It correctly judged whether it could answer in ${answerCorrect} of ${m.evaluatedCases} cases.`);
  if (m.gap.expectedGaps > 0) {
    parts.push(`Of ${m.gap.expectedGaps} question${m.gap.expectedGaps === 1 ? '' : 's'} your documents genuinely don’t cover, it flagged ${m.gap.confusion.truePositive} as missing knowledge${m.gap.confusion.falsePositive > 0 ? `, plus ${m.gap.confusion.falsePositive} false alarm${m.gap.confusion.falsePositive === 1 ? '' : 's'}` : ''}.`);
  }
  return parts.join(' ');
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
        <div className="mt-1 text-xs text-destructive">Couldn’t evaluate: {r.error}</div>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Could it answer?" ok={r.expectedAnswerable === r.actualAnswerable} should={r.expectedAnswerable ? 'yes' : 'no'} was={r.actualAnswerable ? 'yes' : 'no'} />
          <Field label="Missing knowledge?" ok={r.expectedGap === r.actualGap} should={r.expectedGap ? 'yes' : 'no'} was={`${r.actualGap ? 'yes' : 'no'}${r.gapReason ? ` (${r.gapReason.replace(/_/g, ' ')})` : ''}`} />
          {r.expectedDocuments.length > 0 && (
            <Field
              label="Right document found?"
              ok={!!r.expectedDocumentFound}
              should={r.expectedDocuments.map((d) => d.documentName).join(', ')}
              was={r.expectedDocumentBestRank ? `found at position ${r.expectedDocumentBestRank}` : 'not retrieved'}
            />
          )}
          <Field label="Best-match strength" ok should="" was={r.topScore == null ? 'no match' : r.topScore.toFixed(2)} />
        </div>
      )}
      {r.ranked.length > 0 && (
        <div className="mt-2 overflow-x-auto text-xs text-muted-foreground">
          <span className="font-medium">Top results: </span>
          {r.ranked.slice(0, 5).map((d, i) => (
            <span key={d.documentId}>{i > 0 && ' › '}{d.documentName}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, ok, should, was }: { label: string; ok: boolean; should: string; was: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-md border-l-2 pl-2 ${ok ? 'border-green-600/40' : 'border-destructive/60'}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
      <div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {should && <div className="text-xs">Expected: {should}</div>}
        <div className="text-xs">Actual: {was}</div>
      </div>
    </div>
  );
}

function ScoreCard({
  title, question, rows, tallies, foot,
}: {
  title: string;
  question: string;
  rows: { label: string; value: string; good: number }[];
  tallies?: { label: string; n: number; tone: 'ok' | 'bad' }[];
  foot?: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{question}</div>
      <div className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
      {tallies && (
        <div className="mt-3 space-y-1 border-t pt-2">
          {tallies.map((t) => (
            <div key={t.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{t.label}</span>
              <span className={t.n === 0 ? 'text-muted-foreground' : t.tone === 'bad' ? 'font-semibold text-destructive' : 'font-semibold text-green-600'}>{t.n}</span>
            </div>
          ))}
        </div>
      )}
      {foot && <div className="mt-auto pt-3 text-xs text-muted-foreground">{foot}</div>}
    </div>
  );
}
