import { Injectable } from '@nestjs/common';
import type { ExtractedPage } from './text-extractor.interface.js';

export interface ChunkConfigInput {
  chunkSize: number; // target tokens
  chunkOverlap: number; // token overlap
}

export interface ChunkPiece {
  index: number;
  content: string;
  pageNumber: number | null;
  tokenCount: number;
}

// Cheap token estimate (~4 chars/token) to avoid a heavy tokenizer dependency.
// Good enough for chunk sizing; token_count is stored as an estimate.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  const t = text.trim();
  return t ? Math.ceil(t.length / CHARS_PER_TOKEN) : 0;
}

/**
 * Structure-aware chunking: chunk within each page so page numbers stay accurate.
 * Splits on paragraph -> sentence -> word boundaries, then greedily merges to the
 * target size with a trailing overlap carried into the next chunk.
 */
export function chunkPages(pages: ExtractedPage[], cfg: ChunkConfigInput): ChunkPiece[] {
  const maxChars = Math.max(1, Math.floor(cfg.chunkSize * CHARS_PER_TOKEN));
  const overlapChars = Math.min(maxChars - 1, Math.max(0, Math.floor(cfg.chunkOverlap * CHARS_PER_TOKEN)));

  const pieces: ChunkPiece[] = [];
  let index = 0;
  for (const page of pages) {
    const text = page.text?.trim();
    if (!text) continue;
    for (const content of splitText(text, maxChars, overlapChars)) {
      pieces.push({ index: index++, content, pageNumber: page.pageNumber, tokenCount: estimateTokens(content) });
    }
  }
  return pieces;
}

function splitText(text: string, maxChars: number, overlapChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const units: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) units.push(p);
    else units.push(...splitLongUnit(p, maxChars));
  }
  return mergeWithOverlap(units, maxChars, overlapChars);
}

function splitLongUnit(paragraph: string, maxChars: number): string[] {
  const out: string[] = [];
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    let cur = '';
    for (const word of sentence.split(/\s+/)) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (candidate.length > maxChars) {
        if (cur) out.push(cur);
        if (word.length > maxChars) {
          for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
          cur = '';
        } else {
          cur = word;
        }
      } else {
        cur = candidate;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

function mergeWithOverlap(units: string[], maxChars: number, overlapChars: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const unit of units) {
    const candidate = cur ? `${cur}\n\n${unit}` : unit;
    if (candidate.length > maxChars && cur) {
      chunks.push(cur);
      const tail = overlapChars > 0 ? tailByChars(cur, overlapChars) : '';
      cur = tail ? `${tail}\n\n${unit}` : unit;
      if (cur.length > maxChars) cur = unit; // overlap pushed over budget; drop it
    } else {
      cur = candidate;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function tailByChars(text: string, n: number): string {
  if (text.length <= n) return text;
  const slice = text.slice(text.length - n);
  const space = slice.indexOf(' ');
  return space > 0 ? slice.slice(space + 1) : slice;
}

@Injectable()
export class ChunkingService {
  chunk(pages: ExtractedPage[], cfg: ChunkConfigInput): ChunkPiece[] {
    return chunkPages(pages, cfg);
  }
}
