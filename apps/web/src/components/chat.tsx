'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { ArrowUp, Check, ClipboardPaste, Copy, Paperclip, Pencil, X } from 'lucide-react';
import type { Citation, QueryResponse } from '@kb/shared';
import { apiFetch } from '@/lib/api';
import { useDefaultSpace, chatsKey, extractAttachment } from '@/lib/kb';
import { Badge } from '@/components/ui/badge';

interface Attachment {
  name: string;
}
interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  attachments?: Attachment[];
  noAnswer?: boolean;
}
/** A draft attached for the current turn: text lives client-side until sent, then discarded. */
interface PendingAttachment {
  name: string;
  text: string;
}

const DEFAULT_REVIEW_PROMPT = "Review this document against the company's knowledge base.";

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

  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load an existing chat's history (or reset for a new chat).
  useEffect(() => {
    setSessionId(initialSessionId);
    setError(null);
    setEditingId(null);
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

  /** Refetch the persisted chat so messages carry stable ids + attachments. */
  async function reload(sid: string) {
    if (!spaceId) return;
    try {
      const d = await apiFetch<{ messages: Message[] }>(`/spaces/${spaceId}/chats/${sid}`);
      setMessages(d.messages);
    } catch {
      /* keep optimistic view on refetch failure */
    }
  }

  async function onPickFile(files: FileList | null) {
    const file = files?.[0];
    if (!file || !spaceId) return;
    setError(null);
    setAttaching(true);
    try {
      const res = await extractAttachment(spaceId, file);
      setAttachment({ name: res.name, text: res.text });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read file');
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function ask() {
    const text = question.trim();
    if ((!text && !attachment) || !spaceId || busy) return;
    const q = text || DEFAULT_REVIEW_PROMPT;
    const sent = attachment;
    setError(null);
    setQuestion('');
    setAttachment(null);
    setMessages((m) => [
      ...m,
      { role: 'user', content: q, attachments: sent ? [{ name: sent.name }] : undefined },
    ]);
    setBusy(true);
    try {
      const res = await apiFetch<QueryResponse>(`/spaces/${spaceId}/query`, {
        method: 'POST',
        body: JSON.stringify({
          question: q,
          topK: 8,
          ...(sessionId ? { sessionId } : {}),
          ...(sent ? { attachment: { name: sent.name, text: sent.text } } : {}),
        }),
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
      if (res.sessionId) await reload(res.sessionId); // sync ids for edit/copy
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Query failed';
      setError(msg);
      setMessages((m) => [...m, { role: 'assistant', content: `Sorry — ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  /** Save an edited question: truncate the conversation there and re-ask. */
  async function saveEdit(messageId: string) {
    const q = editText.trim();
    if (!q || !spaceId || !sessionId || busy) return;
    setEditingId(null);
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<QueryResponse>(`/spaces/${spaceId}/query`, {
        method: 'POST',
        body: JSON.stringify({ question: q, topK: 8, sessionId, editFromMessageId: messageId }),
      });
      await mutate(chatsKey(spaceId));
      await reload(res.sessionId ?? sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not edit');
    } finally {
      setBusy(false);
    }
  }

  async function copyAnswer(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* clipboard may be unavailable */
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
                  <div key={m.id ?? i} className="group flex flex-col items-end gap-1">
                    {editingId === m.id ? (
                      <div className="w-full max-w-[85%]">
                        <textarea
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                          className="w-full rounded-2xl border bg-background px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              saveEdit(m.id!);
                            }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <div className="mt-1 flex justify-end gap-2">
                          <button onClick={() => setEditingId(null)} className="rounded-full px-3 py-1 text-xs hover:bg-accent">
                            Cancel
                          </button>
                          <button
                            onClick={() => saveEdit(m.id!)}
                            disabled={!editText.trim()}
                            className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2 text-sm">{m.content}</div>
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="flex flex-wrap justify-end gap-1">
                            {m.attachments.map((a, j) => (
                              <span
                                key={j}
                                className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                              >
                                <Paperclip className="h-3 w-3" /> {a.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {m.id && !busy && (
                          <button
                            onClick={() => {
                              setEditingId(m.id!);
                              setEditText(m.content);
                            }}
                            className="flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                            title="Edit"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div key={m.id ?? i} className="group space-y-3">
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
                    <button
                      onClick={() => copyAnswer(m.content, i)}
                      className="flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      title="Copy answer"
                    >
                      {copiedIdx === i ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedIdx === i ? 'Copied' : 'Copy'}
                    </button>
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
          {/* Pending attachment chip */}
          {(attachment || attaching) && (
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs">
                <Paperclip className="h-3 w-3" />
                {attaching ? 'Reading file…' : attachment?.name}
                {attachment && (
                  <button onClick={() => setAttachment(null)} className="ml-1 rounded-full hover:text-destructive" title="Remove">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
              {attachment && (
                <span className="text-xs text-muted-foreground">Attached for this message only — not added to your knowledge base.</span>
              )}
            </div>
          )}
          <div className="flex w-full items-center gap-2 rounded-full border bg-background px-2 py-1.5 pl-3 shadow-sm focus-within:shadow-md">
            {/* Attach menu */}
            <div className="relative">
              <button
                onClick={() => setAttachMenu((v) => !v)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"
                title="Attach a draft"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              {attachMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAttachMenu(false)} />
                  <div className="absolute bottom-10 left-0 z-20 w-52 rounded-lg border bg-background p-1.5 shadow-lg">
                    <button
                      onClick={() => { setAttachMenu(false); fileRef.current?.click(); }}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <Paperclip className="h-4 w-4" /> Attach file
                    </button>
                    <button
                      onClick={() => { setAttachMenu(false); setPasteOpen(true); }}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <ClipboardPaste className="h-4 w-4" /> Paste text
                    </button>
                  </div>
                </>
              )}
            </div>
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={attachment ? 'Ask about the attached draft…' : 'Ask your knowledge base'}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter') ask();
              }}
            />
            <button
              onClick={ask}
              disabled={busy || (!question.trim() && !attachment) || !spaceId}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
              title="Send"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </div>
          {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
        </div>
      </div>

      {/* Hidden file input for attachments */}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown"
        className="hidden"
        onChange={(e) => onPickFile(e.target.files)}
      />

      {/* Paste-text modal */}
      {pasteOpen && (
        <PasteModal
          onCancel={() => setPasteOpen(false)}
          onAttach={(text) => {
            setAttachment({ name: 'Pasted text', text });
            setPasteOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PasteModal({ onCancel, onAttach }: { onCancel: () => void; onAttach: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-base font-medium">Paste a draft to review</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Attached for this message only — it will not be added to your knowledge base.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="Paste your draft here…"
          className="w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-full px-4 py-1.5 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => onAttach(text.trim())}
            disabled={!text.trim()}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Attach
          </button>
        </div>
      </div>
    </div>
  );
}
