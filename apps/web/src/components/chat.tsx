'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { ArrowUp } from 'lucide-react';
import type { Citation, QueryResponse } from '@kb/shared';
import { apiFetch } from '@/lib/api';
import { useDefaultSpace, chatsKey } from '@/lib/kb';
import { Badge } from '@/components/ui/badge';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  noAnswer?: boolean;
}

/** ChatGPT-style conversation. `sessionId` null = new chat; else loads history. */
export function Chat({ sessionId: initialSessionId }: { sessionId: string | null }) {
  const router = useRouter();
  const { spaceId } = useDefaultSpace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!initialSessionId);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load an existing chat's history (or reset for a new chat).
  useEffect(() => {
    setSessionId(initialSessionId);
    setError(null);
    if (!initialSessionId || !spaceId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<{ messages: Message[] }>(`/spaces/${spaceId}/chats/${initialSessionId}`)
      .then((d) => setMessages(d.messages))
      .catch(() => setError('Could not load this chat'))
      .finally(() => setLoading(false));
  }, [initialSessionId, spaceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function ask() {
    const text = question.trim();
    if (!text || !spaceId || busy) return;
    setError(null);
    setQuestion('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    try {
      const res = await apiFetch<QueryResponse>(`/spaces/${spaceId}/query`, {
        method: 'POST',
        body: JSON.stringify({ question: text, topK: 8, ...(sessionId ? { sessionId } : {}) }),
      });
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.answer, citations: res.citations, noAnswer: res.noAnswer },
      ]);
      await mutate(chatsKey(spaceId)); // refresh sidebar (new chat / bumped recency)
      if (res.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId);
        router.replace(`/ask/${res.sessionId}`); // reflect in URL + sidebar highlight
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Query failed';
      setError(msg);
      setMessages((m) => [...m, { role: 'assistant', content: `Sorry — ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  const empty = messages.length === 0 && !loading;

  return (
    <div className="flex h-full flex-col">
      {/* Scrollable conversation */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6">
          {empty ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <h1 className="text-center text-3xl font-semibold tracking-tight">Where should we begin?</h1>
            </div>
          ) : (
            <div className="space-y-6">
              {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2 text-sm">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="space-y-3">
                    {m.noAnswer && (
                      <p className="text-sm text-muted-foreground">
                        No relevant content was found in your knowledge base.
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                    {m.citations && m.citations.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs font-medium text-muted-foreground">Sources</div>
                        <div className="space-y-2">
                          {m.citations.map((c, j) => (
                            <div key={c.chunkId} className="rounded-md border p-3 text-sm">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 font-medium">
                                  [{j + 1}]{' '}
                                  {c.sourceUrl ? (
                                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                                      {c.documentName}
                                    </a>
                                  ) : (
                                    c.documentName
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
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
                ),
              )}
              {busy && <p className="text-sm text-muted-foreground">Thinking…</p>}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* Composer pinned at the bottom */}
      <div className="shrink-0 border-t bg-background">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex w-full items-center gap-2 rounded-full border bg-background px-4 py-2.5 shadow-sm focus-within:shadow-md">
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask your knowledge base"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter') ask();
              }}
            />
            <button
              onClick={ask}
              disabled={busy || !question.trim() || !spaceId}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
              title="Send"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </div>
          {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
