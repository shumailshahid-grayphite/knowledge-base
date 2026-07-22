'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUp, ChevronDown, FileText, Plus, Search, Sparkles } from 'lucide-react';
import type { QueryResponse } from '@kb/shared';
import { apiFetch } from '@/lib/api';
import { useDefaultSpace, useFolders } from '@/lib/kb';
import { Badge } from '@/components/ui/badge';

const SUGGESTIONS = [
  { icon: FileText, text: 'Summarize what a folder contains' },
  { icon: Search, text: 'Find where something is documented' },
  { icon: Sparkles, text: 'Ask a question across everything' },
];

function AskInner() {
  const params = useSearchParams();
  const { spaceId } = useDefaultSpace();
  const { folders } = useFolders(spaceId);

  const [folderId, setFolderId] = useState<string>(params.get('folderId') ?? '');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || !spaceId) return;
    setQuestion(text);
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<QueryResponse>(`/spaces/${spaceId}/query`, {
        method: 'POST',
        body: JSON.stringify({ question: text, topK: 8, ...(folderId ? { filters: { folderId } } : {}) }),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-2 pt-16">
      <h1 className="mb-8 text-center text-3xl font-semibold tracking-tight">Where should we begin?</h1>

      {/* Composer pill */}
      <div className="flex w-full items-center gap-2 rounded-full border bg-background px-3 py-2 shadow-sm focus-within:shadow-md">
        <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent" title="Scope">
          <Plus className="h-5 w-5" />
        </button>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask your knowledge base"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask();
          }}
        />
        {/* Folder scope dropdown (like "Medium") */}
        <div className="relative shrink-0">
          <select
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            className="appearance-none rounded-md bg-transparent py-1 pl-2 pr-6 text-sm text-muted-foreground outline-none hover:bg-accent"
          >
            <option value="">All folders</option>
            {folders?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.path}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <button
          onClick={() => ask()}
          disabled={busy || !question.trim() || !spaceId}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
          title="Ask"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {busy && <p className="mt-3 text-sm text-muted-foreground">Thinking…</p>}

      {/* Suggestions (empty state) */}
      {!result && !busy && (
        <div className="mt-6 w-full max-w-md space-y-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              onClick={() => setQuestion(s.text)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent"
            >
              <s.icon className="h-5 w-5 text-muted-foreground" />
              {s.text}
            </button>
          ))}
        </div>
      )}

      {/* Answer */}
      {result && (
        <div className="mt-8 w-full space-y-4 text-left">
          {result.noAnswer && (
            <p className="text-sm text-muted-foreground">No relevant content was found in this scope.</p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>

          {result.citations.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">Sources</div>
              <div className="space-y-2">
                {result.citations.map((c, i) => (
                  <div key={c.chunkId} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">
                        [{i + 1}]{' '}
                        {c.sourceUrl ? (
                          <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                            {c.documentName}
                          </a>
                        ) : (
                          c.documentName
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {c.pageNumber != null && <Badge variant="outline">p. {c.pageNumber}</Badge>}
                        <Badge variant="secondary">{c.score.toFixed(3)}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
      <AskInner />
    </Suspense>
  );
}
