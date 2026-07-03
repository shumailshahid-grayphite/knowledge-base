import { describe, expect, it } from 'vitest';
import { FakeEmbeddingProvider } from './embedding/fake.js';
import { FakeLlmProvider } from './llm/fake.js';
import { HeuristicReranker } from './reranker/heuristic.js';
import { resolveProviderConfig } from './config.js';

describe('FakeEmbeddingProvider', () => {
  it('is deterministic: same input -> same vector', async () => {
    const p = new FakeEmbeddingProvider(1536);
    const a = await p.embedOne('hello world');
    const b = await p.embedOne('hello world');
    expect(a).toEqual(b);
    expect(a).toHaveLength(1536);
  });

  it('produces unit-length vectors and differs across inputs', async () => {
    const p = new FakeEmbeddingProvider(64);
    const [a, b] = await p.embed(['alpha', 'beta']);
    const norm = Math.sqrt(a!.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
    expect(a).not.toEqual(b);
  });
});

describe('FakeLlmProvider', () => {
  it('is deterministic and uses provided context', async () => {
    const p = new FakeLlmProvider();
    const input = { messages: [{ role: 'user' as const, content: 'The capital is Paris.' }] };
    const r1 = await p.complete(input);
    const r2 = await p.complete(input);
    expect(r1.text).toEqual(r2.text);
    expect(r1.text).toContain('Paris');
  });
});

describe('resolveProviderConfig', () => {
  it('uses fake when no key in dev', () => {
    expect(resolveProviderConfig({ NODE_ENV: 'development' }).mode).toBe('fake');
  });

  it('uses openai when key present', () => {
    expect(resolveProviderConfig({ OPENAI_API_KEY: 'sk-x' }).mode).toBe('openai');
  });

  it('fails fast in production without credentials', () => {
    expect(() => resolveProviderConfig({ NODE_ENV: 'production' })).toThrow();
  });

  it('allows explicit fake in production', () => {
    expect(resolveProviderConfig({ NODE_ENV: 'production', AI_PROVIDER: 'fake' }).mode).toBe('fake');
  });
});

describe('HeuristicReranker', () => {
  const reranker = new HeuristicReranker();
  const candidates = [
    { id: 'a', text: 'nothing relevant here about weather', title: 'Weather.pdf', baseScore: 0.5 },
    { id: 'b', text: 'risk management register reviewed quarterly', title: 'Governance.pdf', metadata: { pageNumber: 4 }, baseScore: 0.5 },
  ];

  it('ranks exact-term + page match above an equal-base non-match', async () => {
    const res = await reranker.rerank('risk management register', candidates);
    const byId = new Map(res.map((r) => [r.id, r.score]));
    expect(byId.get('b')!).toBeGreaterThan(byId.get('a')!);
  });

  it('is deterministic', async () => {
    const r1 = await reranker.rerank('risk register', candidates);
    const r2 = await reranker.rerank('risk register', candidates);
    expect(r1).toEqual(r2);
  });
});
