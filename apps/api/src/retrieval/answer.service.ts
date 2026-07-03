import { Inject, Injectable } from '@nestjs/common';
import type { Citation, LlmProvider, LlmTokenUsage } from '@kb/shared';
import { LLM_PROVIDER } from '../providers/providers.tokens.js';
import type { RetrievedChunk } from './retrieval.service.js';

const SYSTEM_PROMPT = [
  'You are a knowledge base assistant for a company.',
  'Answer the question using ONLY the provided context blocks.',
  'Cite the sources you use inline with bracketed numbers like [1], [2] that map to the context blocks.',
  'If the answer is not contained in the context, say you could not find it in the knowledge base.',
  'Do NOT use outside knowledge. Do NOT invent citations or facts.',
].join(' ');

export interface GeneratedAnswer {
  text: string;
  citations: Citation[];
  model: string;
  usage?: LlmTokenUsage;
}

/** Grounded answer generation + citation formatting. Provider-agnostic. */
@Injectable()
export class AnswerService {
  constructor(@Inject(LLM_PROVIDER) private readonly llm: LlmProvider) {}

  async generate(question: string, chunks: RetrievedChunk[]): Promise<GeneratedAnswer> {
    const context = chunks
      .map((c, i) => {
        const loc = c.pageNumber ? `, page ${c.pageNumber}` : '';
        return `[${i + 1}] (Document: "${c.documentName}"${loc}):\n${c.content}`;
      })
      .join('\n\n');

    const result = await this.llm.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `Question: ${question}\n\nContext:\n${context}\n\n` +
            'Answer using ONLY the context above and cite sources inline as [n]. ' +
            'If the answer is not present, say you could not find it in the knowledge base.',
        },
      ],
      temperature: 0.1,
    });

    // Citations are built only from the REAL retrieved chunks (never invented).
    const referenced = extractReferencedIndexes(result.text, chunks.length);
    const chosen = referenced.length > 0 ? referenced.map((n) => chunks[n - 1]!) : chunks;
    const citations: Citation[] = chosen.map((c) => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      documentName: c.documentName,
      sourceUrl: c.sourceUrl,
      pageNumber: c.pageNumber,
      score: c.score,
    }));

    return { text: result.text, citations, model: result.model, usage: result.usage };
  }
}

/** Parse unique [n] markers that fall within the provided context range. */
function extractReferencedIndexes(text: string, max: number): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= max) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}
