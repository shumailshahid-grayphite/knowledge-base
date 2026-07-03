'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import type { QueryResponse, SpaceResponse } from '@kb/shared';
import { apiFetch, fetcher } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

export default function AskPage() {
  const { id } = useParams<{ id: string }>();
  const { data: space } = useSWR<SpaceResponse>(`/spaces/${id}`, fetcher);

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);

  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<QueryResponse>(`/spaces/${id}/query`, {
        method: 'POST',
        body: JSON.stringify({ question, topK: 8 }),
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
        <Link href={`/spaces/${id}`} className="text-sm text-muted-foreground hover:underline">
          ← {space?.name ?? 'Space'}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Ask the knowledge base</h1>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about the documents in this space…"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button onClick={ask} disabled={busy || !question.trim()}>
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
              <CardDescription>No relevant content was found in this space.</CardDescription>
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
