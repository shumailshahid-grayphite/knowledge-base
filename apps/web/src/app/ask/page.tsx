'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { QueryResponse } from '@kb/shared';
import { apiFetch } from '@/lib/api';
import { useDefaultSpace, useFolders } from '@/lib/kb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

function AskInner() {
  const params = useSearchParams();
  const { spaceId } = useDefaultSpace();
  const { folders } = useFolders(spaceId);

  const [folderId, setFolderId] = useState<string>(params.get('folderId') ?? '');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);

  async function ask() {
    if (!question.trim() || !spaceId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<QueryResponse>(`/spaces/${spaceId}/query`, {
        method: 'POST',
        body: JSON.stringify({
          question,
          topK: 8,
          ...(folderId ? { filters: { folderId } } : {}),
        }),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ask the knowledge base</h1>
        <p className="text-muted-foreground">Grounded answers with citations. Scope to a folder or search everything.</p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Search in:</span>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">All folders</option>
              {folders?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">(includes subfolders)</span>
          </div>
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your documents…"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button onClick={ask} disabled={busy || !question.trim() || !spaceId}>
              {busy ? 'Thinking…' : 'Ask'}
            </Button>
            <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter</span>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Answer</CardTitle>
            {result.noAnswer && (
              <CardDescription>No relevant content was found in this scope.</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
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
