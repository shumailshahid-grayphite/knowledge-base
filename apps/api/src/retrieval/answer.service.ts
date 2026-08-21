import { Inject, Injectable } from '@nestjs/common';
import type { Citation, LlmProvider, LlmTokenUsage } from '@kb/shared';
import { LLM_PROVIDER } from '../providers/providers.tokens.js';
import type { RetrievedChunk } from './retrieval.service.js';

const SYSTEM_PROMPT = [
  "You are an assistant for a company's knowledge base.",
  'When the provided context blocks are relevant, base your answer on them and cite inline with [1], [2] mapping to the blocks.',
  'You may reason over the context: summarize, compare, rate/critique a document against others, and identify gaps, risks, or loopholes — grounded in what the documents say, citing the blocks that support each factual claim.',
  'If the context does not cover the question, you may still answer from your general knowledge, but clearly state that this part is general information not drawn from the company documents (it will have no citation).',
  'Never fabricate citations or attribute invented facts to the documents. Keep a clear line between what the documents say (cited) and your own analysis or general knowledge (uncited).',
].join(' ');

export interface GeneratedAnswer {
  text: string;
  citations: Citation[];
  model: string;
  usage?: LlmTokenUsage;
}

/** A prior conversation turn, passed so follow-up questions have context. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Grounded answer generation + citation formatting. Provider-agnostic. */
@Injectable()
export class AnswerService {
  constructor(@Inject(LLM_PROVIDER) private readonly llm: LlmProvider) {}

  async generate(
    question: string,
    chunks: RetrievedChunk[],
    history: ChatTurn[] = [],
  ): Promise<GeneratedAnswer> {
    const context =
      chunks.length > 0
        ? chunks
            .map((c, i) => {
              const loc = c.pageNumber ? `, page ${c.pageNumber}` : '';
              return `[${i + 1}] (Document: "${c.documentName}"${loc}):\n${c.content}`;
            })
            .join('\n\n')
        : '(No relevant company documents were found for this question.)';

    const result = await this.llm.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        // Prior turns give the model conversational context (e.g. "what about seniors?").
        ...history.map((h) => ({ role: h.role, content: h.content })),
        {
          role: 'user',
          content:
            `Question: ${question}\n\nContext:\n${context}\n\n` +
            'Cite documents you use inline as [n]. Use the prior conversation only to interpret the question. ' +
            'If the context does not answer it, answer from general knowledge and note that it is not from the company documents.',
        },
      ],
      temperature: 0.2,
    });

    // Citations are ONLY the chunks the answer actually referenced (empty for a
    // general-knowledge answer). Never invented.
    const referenced = extractReferencedIndexes(result.text, chunks.length);
    const chosen = referenced.map((n) => chunks[n - 1]!);
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

  /**
   * Rewrite a follow-up question into a standalone search query using the prior
   * turns, so retrieval isn't crippled by pronouns/ellipsis ("what about seniors?",
   * "point out loopholes"). Returns the original question on any failure or when
   * there is no history to resolve against.
   */
  async condenseQuery(question: string, history: ChatTurn[]): Promise<string> {
    if (history.length === 0) return question;
    try {
      const convo = history.map((h) => `${h.role}: ${h.content}`).join('\n');
      const result = await this.llm.complete({
        messages: [
          {
            role: 'system',
            content:
              'Rewrite the user\'s latest message into a single, self-contained search query for a ' +
              'company document knowledge base. Resolve pronouns and references using the conversation, ' +
              'and keep the specific subject/entities. Reply with ONLY the query text — no quotes, no prose.',
          },
          { role: 'user', content: `Conversation:\n${convo}\n\nLatest message: ${question}\n\nSearch query:` },
        ],
        temperature: 0,
      });
      const rewritten = result.text.trim().replace(/^["']|["']$/g, '');
      return rewritten.length > 0 ? rewritten : question;
    } catch {
      return question;
    }
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
