import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmbeddingProvider, RerankCandidate, Reranker, RetrievalFilters } from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { EMBEDDING_PROVIDER, RERANKER } from '../providers/providers.tokens.js';
import { VectorSearchService, type VectorSearchParams } from './vector-search.service.js';
import { KeywordSearchService } from './keyword-search.service.js';

export interface RetrievedChunk {
  chunkId: string;
  content: string;
  pageNumber: number | null;
  chunkIndex: number;
  documentId: string;
  documentName: string;
  sourceUrl: string | null;
  contentHash: string | null;
  // Scoring detail (for citations + retrieval logs).
  vectorScore: number; // raw cosine (0 if not a vector hit)
  keywordScore: number; // raw ts_rank (0 if not a keyword hit)
  combinedScore: number; // normalized, weighted hybrid (0..1)
  rerankScore: number; // final reranker score
  rank: number; // 1-based final rank
  /** Citation-facing score (= rerankScore). Kept for API/UI stability. */
  score: number;
}

export interface RetrieveParams {
  organizationId: string;
  spaceId: string;
  question: string;
  topK: number;
  filters?: RetrievalFilters;
}

interface Merged {
  chunkId: string;
  documentId: string;
  vectorScore: number;
  keywordScore: number;
  combinedScore: number;
}

/**
 * Hybrid retrieval: pgvector cosine + Postgres full-text, normalized and merged,
 * deduplicated + per-document capped, reranked, then trimmed to a token budget.
 * All internal — the ask/search API contract is unchanged.
 *
 * Fallbacks: if embedding fails (e.g. fake/dev with no key wired), keyword-only;
 * if full-text fails, vector-only; if both empty, caller returns not-found.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
    private readonly vectorSearch: VectorSearchService,
    private readonly keywordSearch: KeywordSearchService,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
    @Inject(RERANKER) private readonly reranker: Reranker,
  ) {}

  async retrieve(params: RetrieveParams): Promise<RetrievedChunk[]> {
    const env = this.config.env;
    const poolK = env.RETRIEVAL_CANDIDATE_POOL;
    const sp: VectorSearchParams = {
      organizationId: params.organizationId,
      spaceId: params.spaceId,
      filters: params.filters,
    };

    // 1) Embed the query (vector path). Failure -> keyword-only.
    let embedding: number[] | null = null;
    try {
      embedding = await this.embedder.embedOne(params.question);
    } catch (err) {
      this.logger.warn({ err: asMessage(err) }, 'embedding failed; falling back to keyword-only');
    }

    // 2) Run both searches independently; either may fail without failing the query.
    const [vectorRes, keywordRes] = await Promise.allSettled([
      embedding ? this.vectorSearch.search(embedding, sp, poolK) : Promise.resolve([]),
      this.keywordSearch.search(params.question, sp, poolK),
    ]);

    const vectorHits =
      vectorRes.status === 'fulfilled'
        ? vectorRes.value
        : (this.logger.warn({ err: asMessage(vectorRes.reason) }, 'vector search failed'), []);
    const keywordHits =
      keywordRes.status === 'fulfilled'
        ? keywordRes.value
        : (this.logger.warn({ err: asMessage(keywordRes.reason) }, 'keyword search failed'), []);

    if (vectorHits.length === 0 && keywordHits.length === 0) return [];

    // 3) Normalize each score set to [0,1] and merge with configured weights.
    const vNorm = normalize(vectorHits.map((h) => h.score));
    const kNorm = normalize(keywordHits.map((h) => h.score));
    const merged = new Map<string, Merged>();

    vectorHits.forEach((h, i) => {
      merged.set(h.chunkId, {
        chunkId: h.chunkId,
        documentId: h.documentId,
        vectorScore: h.score,
        keywordScore: 0,
        combinedScore: env.RETRIEVAL_VECTOR_WEIGHT * vNorm[i]!,
      });
    });
    keywordHits.forEach((h, i) => {
      const existing = merged.get(h.chunkId);
      const keywordComponent = env.RETRIEVAL_KEYWORD_WEIGHT * kNorm[i]!;
      if (existing) {
        existing.keywordScore = h.score;
        existing.combinedScore += keywordComponent;
      } else {
        merged.set(h.chunkId, {
          chunkId: h.chunkId,
          documentId: h.documentId,
          vectorScore: 0,
          keywordScore: h.score,
          combinedScore: keywordComponent,
        });
      }
    });

    // 4) Hydrate citation metadata for the merged candidates.
    const candidateIds = [...merged.keys()];
    const rows = await this.database.db
      .selectFrom('chunks as c')
      .innerJoin('documents as d', 'd.id', 'c.document_id')
      .select([
        'c.id as chunkId',
        'c.content as content',
        'c.page_number as pageNumber',
        'c.chunk_index as chunkIndex',
        'c.content_hash as contentHash',
        'd.id as documentId',
        'd.file_name as documentName',
        'd.source_url as sourceUrl',
      ])
      .where('c.id', 'in', candidateIds)
      .execute();

    let candidates: RetrievedChunk[] = rows.map((r) => {
      const m = merged.get(r.chunkId)!;
      return {
        chunkId: r.chunkId,
        content: r.content,
        pageNumber: r.pageNumber,
        chunkIndex: r.chunkIndex,
        documentId: r.documentId,
        documentName: r.documentName,
        sourceUrl: r.sourceUrl,
        contentHash: r.contentHash,
        vectorScore: m.vectorScore,
        keywordScore: m.keywordScore,
        combinedScore: m.combinedScore,
        rerankScore: 0,
        rank: 0,
        score: 0,
      };
    });

    // 5) Drop exact-duplicate content (keep the higher combined score).
    candidates = dedupeByContentHash(candidates);

    // 6) Rerank the strongest merged candidates only (bounds LLM-rerank cost),
    //    then drop anything below the relevance floor so weak/off-topic chunks
    //    never reach the answer. Nothing above the floor => general-knowledge answer.
    candidates.sort((a, b) => b.combinedScore - a.combinedScore);
    candidates = candidates.slice(0, env.RETRIEVAL_RERANK_POOL);

    const rerankInput: RerankCandidate[] = candidates.map((c) => ({
      id: c.chunkId,
      text: c.content,
      title: c.documentName,
      metadata: { pageNumber: c.pageNumber },
      baseScore: c.combinedScore,
    }));
    const rerankScores = new Map(
      (await this.reranker.rerank(params.question, rerankInput)).map((r) => [r.id, r.score]),
    );
    candidates.forEach((c) => (c.rerankScore = rerankScores.get(c.chunkId) ?? c.combinedScore));
    candidates = candidates.filter((c) => c.rerankScore >= env.RETRIEVAL_MIN_SCORE);
    candidates.sort((a, b) => b.rerankScore - a.rerankScore);
    if (candidates.length === 0) return [];

    // 7) Final selection: per-doc cap (unless highly relevant) + token budget + topK.
    const selected: RetrievedChunk[] = [];
    const perDoc = new Map<string, number>();
    let tokens = 0;
    for (const c of candidates) {
      if (selected.length >= params.topK) break;
      const used = perDoc.get(c.documentId) ?? 0;
      const highlyRelevant = c.rerankScore >= env.RETRIEVAL_HIGH_RELEVANCE;
      if (used >= env.RETRIEVAL_MAX_PER_DOC && !highlyRelevant) continue;

      const chunkTokens = estimateTokens(c.content);
      if (selected.length > 0 && tokens + chunkTokens > env.RETRIEVAL_TOKEN_BUDGET) continue;

      c.score = c.rerankScore;
      c.rank = selected.length + 1;
      selected.push(c);
      perDoc.set(c.documentId, used + 1);
      tokens += chunkTokens;
    }

    this.logger.debug(
      {
        vector: vectorHits.length,
        keyword: keywordHits.length,
        merged: merged.size,
        selected: selected.length,
        tokens,
      },
      'hybrid retrieval complete',
    );
    return selected;
  }
}

function normalize(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => 1); // all equal -> treat as fully relevant
  return scores.map((s) => (s - min) / (max - min));
}

function dedupeByContentHash(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Map<string, RetrievedChunk>();
  const out: RetrievedChunk[] = [];
  for (const c of chunks) {
    if (!c.contentHash) {
      out.push(c);
      continue;
    }
    const prev = seen.get(c.contentHash);
    if (!prev) {
      seen.set(c.contentHash, c);
      out.push(c);
    } else if (c.combinedScore > prev.combinedScore) {
      // Replace the earlier, lower-scored duplicate.
      out[out.indexOf(prev)] = c;
      seen.set(c.contentHash, c);
    }
  }
  return out;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
