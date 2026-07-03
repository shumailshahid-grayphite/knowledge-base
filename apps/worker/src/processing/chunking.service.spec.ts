import { describe, expect, it } from 'vitest';
import { chunkPages, estimateTokens } from './chunking.service.js';
import type { ExtractedPage } from './text-extractor.interface.js';

const cfg = { chunkSize: 50, chunkOverlap: 10 }; // ~200 chars, ~40 overlap
const maxChars = cfg.chunkSize * 4;

describe('chunkPages', () => {
  it('returns a single chunk for short text', () => {
    const pages: ExtractedPage[] = [{ pageNumber: 1, text: 'Hello world.' }];
    const chunks = chunkPages(pages, cfg);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('Hello world.');
    expect(chunks[0]!.pageNumber).toBe(1);
    expect(chunks[0]!.index).toBe(0);
  });

  it('splits long text into multiple chunks, each within the size budget', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = sentence.repeat(40); // ~1800 chars
    const chunks = chunkPages([{ pageNumber: 3, text }], cfg);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(maxChars);
      expect(c.pageNumber).toBe(3);
    }
  });

  it('assigns contiguous, monotonically increasing indexes across pages', () => {
    const long = 'word '.repeat(300);
    const chunks = chunkPages(
      [
        { pageNumber: 1, text: long },
        { pageNumber: 2, text: long },
      ],
      cfg,
    );
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    expect(chunks.some((c) => c.pageNumber === 1)).toBe(true);
    expect(chunks.some((c) => c.pageNumber === 2)).toBe(true);
  });

  it('carries overlap between consecutive chunks of the same page', () => {
    const text = Array.from({ length: 60 }, (_, i) => `sentence${i} is here.`).join(' ');
    const chunks = chunkPages([{ pageNumber: 1, text }], { chunkSize: 40, chunkOverlap: 12 });
    expect(chunks.length).toBeGreaterThan(1);
    // The start of chunk[1] should share some trailing content of chunk[0].
    const prevTail = chunks[0]!.content.slice(-20).trim().split(' ').pop()!;
    expect(chunks[1]!.content).toContain(prevTail);
  });

  it('skips empty/whitespace pages', () => {
    const chunks = chunkPages(
      [
        { pageNumber: 1, text: '   ' },
        { pageNumber: 2, text: 'Real content here.' },
      ],
      cfg,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pageNumber).toBe(2);
  });

  it('estimateTokens is ~chars/4 and 0 for empty', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
