import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  AuthUser,
  EmbeddingProvider,
  GapReason,
  GapRetrievalOutcome,
  GapStatus,
  GapWeakMatch,
  KnowledgeGapDetail,
  KnowledgeGapMetrics,
  KnowledgeGapSummary,
} from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { EMBEDDING_PROVIDER } from '../providers/providers.tokens.js';

/** Minimal view of a surviving retrieved chunk — avoids coupling to RetrievalService. */
export interface GapEvidence {
  documentName: string;
  score: number;
  pageNumber: number | null;
}

export interface RecordGapInput {
  user: AuthUser;
  sessionId: string | null;
  messageId: string | null;
  question: string;
  standaloneQuestion: string;
  /** Survivors of the existing retrieval threshold (may be empty). */
  evidence: GapEvidence[];
}

/**
 * Knowledge Gaps V1. Consumes the EXISTING retrieval pipeline's output to decide
 * whether a question was inadequately supported, records a tenant-scoped signal,
 * and groups similar signals into recurring gaps using the embeddings/pgvector
 * infra already in the project. All admin reads/writes are org-scoped and rely on
 * FORCE RLS as defense-in-depth.
 */
@Injectable()
export class KnowledgeGapsService {
  private readonly logger = new Logger(KnowledgeGapsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
  ) {}

  // ---- Recording (employee chat path) -------------------------------------

  /**
   * If the retrieval evidence was insufficient, record a gap signal and group it.
   * Best-effort: any failure is swallowed so chat is never affected.
   */
  async recordIfGap(input: RecordGapInput): Promise<void> {
    if (!this.config.env.KNOWLEDGE_GAPS_ENABLED) return;

    const verdict = this.classifyEvidence(input.evidence);
    if (!verdict) return; // adequately answered -> not a gap

    try {
      await this.persistSignal(input, verdict);
    } catch (err) {
      // Never let gap tracking break the chat response.
      this.logger.warn({ err: msg(err) }, 'knowledge-gap recording failed (ignored)');
    }
  }

  /**
   * Deterministic gap classification from retrieval output — the SINGLE
   * implementation used by live chat, evaluation, and threshold simulation.
   * `adequacyScore` defaults to the configured value; evaluation passes candidate
   * values to simulate thresholds against preserved scores. Returns null when the
   * evidence is adequate (i.e. not a gap).
   */
  classifyEvidence(
    evidence: GapEvidence[],
    adequacyScore: number = this.config.env.KNOWLEDGE_GAPS_ADEQUACY_SCORE,
  ): {
    reason: GapReason;
    outcome: GapRetrievalOutcome;
    topScore: number | null;
    weakMatches: GapWeakMatch[];
  } | null {
    if (evidence.length === 0) {
      return { reason: 'no_relevant_knowledge', outcome: 'no_results', topScore: null, weakMatches: [] };
    }
    const topScore = Math.max(...evidence.map((e) => e.score));
    if (topScore < adequacyScore) {
      const weakMatches = [...evidence]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((e) => ({ documentName: e.documentName, score: e.score, pageNumber: e.pageNumber }));
      return { reason: 'weak_evidence', outcome: 'weak', topScore, weakMatches };
    }
    return null; // adequate evidence
  }

  private async persistSignal(
    input: RecordGapInput,
    verdict: { reason: GapReason; outcome: GapRetrievalOutcome; topScore: number | null; weakMatches: GapWeakMatch[] },
  ): Promise<void> {
    const orgId = input.user.organizationId;
    const literal = await this.embedLiteral(input.standaloneQuestion);
    const gapId = await this.resolveGap(orgId, input.standaloneQuestion, literal);

    await this.database.db
      .insertInto('knowledge_gap_signals')
      .values({
        organization_id: orgId,
        gap_id: gapId,
        session_id: input.sessionId,
        message_id: input.messageId,
        user_id: input.user.id,
        question: input.question,
        standalone_question: input.standaloneQuestion,
        embedding: literal,
        retrieval_outcome: verdict.outcome,
        reason: verdict.reason,
        top_score: verdict.topScore,
        weak_matches: JSON.stringify(verdict.weakMatches),
      })
      .execute();
  }

  /** Embed the standalone question to a pgvector literal, or null if unavailable. */
  private async embedLiteral(text: string): Promise<string | null> {
    try {
      const vec = await this.embedder.embedOne(text);
      return `[${vec.join(',')}]`;
    } catch (err) {
      this.logger.warn({ err: msg(err) }, 'gap embedding failed; grouping by text');
      return null;
    }
  }

  /**
   * Find the gap this signal belongs to (nearest centroid above threshold), else
   * create a new open gap. Matches gaps of any status: a resolved match reopens
   * (recurrence resurfaces it); an ignored match still accrues occurrences but
   * stays muted; an open match just grows. Falls back to exact-title match when no
   * embedding is available.
   */
  private async resolveGap(orgId: string, title: string, literal: string | null): Promise<string> {
    const nearest = literal
      ? await this.database.db
          .selectFrom('knowledge_gaps')
          .select(['id', 'status'])
          .select(sql<number>`1 - (centroid_embedding <=> ${literal}::vector)`.as('similarity'))
          .where('organization_id', '=', orgId)
          .where('centroid_embedding', 'is not', null)
          .orderBy(sql`centroid_embedding <=> ${literal}::vector`)
          .limit(1)
          .executeTakeFirst()
      : await this.database.db
          .selectFrom('knowledge_gaps')
          .select(['id', 'status'])
          .select(sql<number>`1`.as('similarity'))
          .where('organization_id', '=', orgId)
          .where(sql<boolean>`lower(title) = lower(${title})`)
          .limit(1)
          .executeTakeFirst();

    const matched = nearest && (literal ? nearest.similarity >= this.config.env.KNOWLEDGE_GAPS_SIMILARITY : true);
    if (matched && nearest) {
      // Reopen a resolved gap on recurrence; leave ignored gaps muted.
      const reopen = nearest.status === 'resolved';
      await this.database.db
        .updateTable('knowledge_gaps')
        .set({
          occurrence_count: sql`occurrence_count + 1`,
          last_seen_at: new Date(),
          ...(reopen ? { status: 'open' as GapStatus, resolved_at: null } : {}),
        })
        .where('id', '=', nearest.id)
        .where('organization_id', '=', orgId)
        .execute();
      return nearest.id;
    }

    const created = await this.database.db
      .insertInto('knowledge_gaps')
      .values({
        organization_id: orgId,
        status: 'open',
        title: title.slice(0, 300),
        centroid_embedding: literal,
        occurrence_count: 1,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return created.id;
  }

  // ---- Admin dashboard (owner/admin only; enforced by RolesGuard) ----------

  async list(user: AuthUser, status?: GapStatus): Promise<KnowledgeGapSummary[]> {
    let q = this.database.db
      .selectFrom('knowledge_gaps as g')
      .leftJoin('knowledge_gap_signals as s', (join) =>
        join.onRef('s.gap_id', '=', 'g.id').on('s.organization_id', '=', user.organizationId),
      )
      .select([
        'g.id as id',
        'g.title as title',
        'g.status as status',
        'g.occurrence_count as occurrenceCount',
        'g.first_seen_at as firstSeenAt',
        'g.last_seen_at as lastSeenAt',
      ])
      .select(sql<number>`count(distinct s.user_id)`.as('distinctUsers'))
      .where('g.organization_id', '=', user.organizationId)
      .groupBy(['g.id'])
      .orderBy('g.occurrence_count', 'desc')
      .orderBy('g.last_seen_at', 'desc');

    if (status) q = q.where('g.status', '=', status);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status as GapStatus,
      occurrenceCount: Number(r.occurrenceCount),
      distinctUsers: Number(r.distinctUsers),
      firstSeenAt: iso(r.firstSeenAt),
      lastSeenAt: iso(r.lastSeenAt),
    }));
  }

  async detail(user: AuthUser, gapId: string): Promise<KnowledgeGapDetail> {
    const g = await this.database.db
      .selectFrom('knowledge_gaps')
      .select([
        'id',
        'title',
        'status',
        'occurrence_count as occurrenceCount',
        'first_seen_at as firstSeenAt',
        'last_seen_at as lastSeenAt',
        'resolved_at as resolvedAt',
      ])
      .where('id', '=', gapId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!g) throw new NotFoundException('Knowledge gap not found');

    const signals = await this.database.db
      .selectFrom('knowledge_gap_signals')
      .select([
        'id',
        'question',
        'standalone_question as standaloneQuestion',
        'reason',
        'retrieval_outcome as retrievalOutcome',
        'top_score as topScore',
        'weak_matches as weakMatches',
        'created_at as createdAt',
        'user_id as userId',
      ])
      .where('gap_id', '=', gapId)
      .where('organization_id', '=', user.organizationId)
      .orderBy('created_at', 'desc')
      .limit(25)
      .execute();

    const distinctUsers = new Set(signals.map((s) => s.userId).filter(Boolean)).size;
    const reasonBreakdown = { no_relevant_knowledge: 0, weak_evidence: 0 };
    for (const s of signals) {
      if (s.reason === 'no_relevant_knowledge' || s.reason === 'weak_evidence') {
        reasonBreakdown[s.reason] += 1;
      }
    }

    return {
      id: g.id,
      title: g.title,
      status: g.status as GapStatus,
      occurrenceCount: Number(g.occurrenceCount),
      distinctUsers,
      firstSeenAt: iso(g.firstSeenAt),
      lastSeenAt: iso(g.lastSeenAt),
      resolvedAt: g.resolvedAt ? iso(g.resolvedAt) : null,
      reasonBreakdown,
      signals: signals.map((s) => ({
        id: s.id,
        question: s.question,
        standaloneQuestion: s.standaloneQuestion,
        reason: s.reason as GapReason,
        retrievalOutcome: s.retrievalOutcome as GapRetrievalOutcome,
        topScore: s.topScore == null ? null : Number(s.topScore),
        weakMatches: (s.weakMatches ?? []) as GapWeakMatch[],
        createdAt: iso(s.createdAt),
      })),
    };
  }

  async updateStatus(user: AuthUser, gapId: string, status: GapStatus): Promise<{ id: string; status: GapStatus }> {
    const resolving = status === 'resolved';
    const res = await this.database.db
      .updateTable('knowledge_gaps')
      .set({
        status,
        resolved_at: resolving ? new Date() : null,
        resolved_by: resolving ? user.id : null,
      })
      .where('id', '=', gapId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!res.numUpdatedRows) throw new NotFoundException('Knowledge gap not found');
    return { id: gapId, status };
  }

  async metrics(user: AuthUser): Promise<KnowledgeGapMetrics> {
    const orgId = user.organizationId;

    const totalRow = await this.database.db
      .selectFrom('retrieval_logs')
      .select(sql<number>`count(*)`.as('n'))
      .where('organization_id', '=', orgId)
      .where('source', '=', 'chat')
      .executeTakeFirst();
    const totalQuestions = Number(totalRow?.n ?? 0);

    const byReason = await this.database.db
      .selectFrom('knowledge_gap_signals')
      .select(['reason'])
      .select(sql<number>`count(*)`.as('n'))
      .where('organization_id', '=', orgId)
      .groupBy('reason')
      .execute();
    const signalsByReason = { no_relevant_knowledge: 0, weak_evidence: 0 };
    let gapSignals = 0;
    for (const r of byReason) {
      const n = Number(r.n);
      gapSignals += n;
      if (r.reason === 'no_relevant_knowledge' || r.reason === 'weak_evidence') {
        signalsByReason[r.reason as GapReason] = n;
      }
    }

    const gapsByStatus = await this.database.db
      .selectFrom('knowledge_gaps')
      .select(['status'])
      .select(sql<number>`count(*)`.as('n'))
      .select(sql<number>`count(*) filter (where occurrence_count >= 2)`.as('recurring'))
      .where('organization_id', '=', orgId)
      .groupBy('status')
      .execute();
    let openGaps = 0;
    let resolvedGaps = 0;
    let ignoredGaps = 0;
    let recurringGaps = 0;
    for (const r of gapsByStatus) {
      const n = Number(r.n);
      recurringGaps += Number(r.recurring);
      if (r.status === 'open') openGaps = n;
      else if (r.status === 'resolved') resolvedGaps = n;
      else if (r.status === 'ignored') ignoredGaps = n;
    }

    return {
      totalQuestions,
      answeredFromKb: Math.max(0, totalQuestions - gapSignals),
      gapSignals,
      gapSignalRate: totalQuestions > 0 ? gapSignals / totalQuestions : 0,
      signalsByReason,
      recurringGaps,
      openGaps,
      resolvedGaps,
      ignoredGaps,
    };
  }
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}
function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
