import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthUser, EmbeddingProvider } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { RolesGuard } from '../common/roles.guard.js';
import { Roles } from '../common/roles.decorator.js';
import { KnowledgeGapsService, type GapEvidence } from './knowledge-gaps.service.js';

// ---- RolesGuard (no DB) -----------------------------------------------------

class Protected {
  @Roles('owner', 'admin')
  adminOnly() {}
  openHandler() {}
}

const ctxFor = (handler: unknown, user: Partial<AuthUser>): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => Protected,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a matching role', () => {
    expect(guard.canActivate(ctxFor(Protected.prototype.adminOnly, { role: 'admin' }))).toBe(true);
    expect(guard.canActivate(ctxFor(Protected.prototype.adminOnly, { role: 'owner' }))).toBe(true);
  });

  it('rejects a non-matching role', () => {
    expect(() => guard.canActivate(ctxFor(Protected.prototype.adminOnly, { role: 'member' }))).toThrow();
    expect(() => guard.canActivate(ctxFor(Protected.prototype.adminOnly, { role: 'viewer' }))).toThrow();
  });

  it('allows handlers without @Roles', () => {
    expect(guard.canActivate(ctxFor(Protected.prototype.openHandler, { role: 'member' }))).toBe(true);
  });
});

// ---- Service (integration against local Postgres) ---------------------------

const HAS_DB = !!(process.env.APP_DATABASE_URL || process.env.DATABASE_URL);
const TOKEN = 'KGV1TEST';
const ORG_A = '00000000-0000-0000-0000-000000000001';
const USER_A = '00000000-0000-0000-0000-000000000002';
const USER_A2 = '11111111-1111-1111-1111-1111111111a2';
const ORG_B = '22222222-2222-2222-2222-222222222b00';
const USER_B = '22222222-2222-2222-2222-222222222b01';

/** Deterministic embedder: same topic -> same one-hot vector; unrelated -> orthogonal. */
const DIM = 1536;
function oneHot(i: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
}
const stubEmbedder: EmbeddingProvider = {
  model: 'stub',
  dimension: DIM,
  async embedOne(text: string): Promise<number[]> {
    const t = text.toLowerCase();
    if (t.includes('reimburse') || t.includes('expense')) return oneHot(0);
    if (t.includes('incident') || t.includes('escalat')) return oneHot(1);
    if (t.includes('offboard')) return oneHot(2);
    return oneHot(3);
  },
  async embed(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embedOne(t)));
  },
};

const user = (id: string, org: string, role: AuthUser['role']): AuthUser => ({
  id,
  email: `${id}@test`,
  name: null,
  organizationId: org,
  role,
});

describe.skipIf(!HAS_DB)('KnowledgeGapsService', () => {
  let db: DatabaseService;
  let service: KnowledgeGapsService;
  let kbB: string;

  const adminA = user(USER_A, ORG_A, 'owner');
  const adminA2 = user(USER_A2, ORG_A, 'admin');
  const adminB = user(USER_B, ORG_B, 'owner');

  const q = (s: string) => `${TOKEN} ${s}`;
  const record = (u: AuthUser, question: string, evidence: GapEvidence[]) =>
    db.runWithTenant(u.organizationId, () =>
      service.recordIfGap({
        user: u,
        sessionId: null,
        messageId: null,
        question,
        standaloneQuestion: question,
        evidence,
      }),
    );
  const signalsFor = (org: string, question: string) =>
    db.runWithTenant(org, () =>
      db.db
        .selectFrom('knowledge_gap_signals')
        .selectAll()
        .where('organization_id', '=', org)
        .where('standalone_question', '=', question)
        .execute(),
    );

  beforeAll(async () => {
    db = new DatabaseService(new AppConfigService());
    service = new KnowledgeGapsService(db, new AppConfigService(), stubEmbedder);

    // Second user in org A (non-RLS tables).
    await db.db
      .insertInto('users')
      .values({ id: USER_A2, email: `${USER_A2}@test`, name: 'A2', password_hash: 'x' })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await db.db
      .insertInto('memberships')
      .values({ organization_id: ORG_A, user_id: USER_A2, role: 'admin' })
      .onConflict((oc) => oc.doNothing())
      .execute();

    // Fresh, empty org B for isolation + deterministic metrics.
    await db.db
      .insertInto('organizations')
      .values({ id: ORG_B, name: 'Org B', slug: `orgb-${TOKEN.toLowerCase()}` })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await db.db
      .insertInto('users')
      .values({ id: USER_B, email: `${USER_B}@test`, name: 'B', password_hash: 'x' })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await db.db
      .insertInto('memberships')
      .values({ organization_id: ORG_B, user_id: USER_B, role: 'owner' })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await db.runWithTenant(ORG_B, async () => {
      const kb = await db.db
        .insertInto('knowledge_base')
        .values({ organization_id: ORG_B, name: 'B KB' })
        .returning('id')
        .executeTakeFirstOrThrow();
      kbB = kb.id;
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.runWithTenant(ORG_A, async () => {
      await db.db.deleteFrom('knowledge_gap_signals').where('organization_id', '=', ORG_A).where('standalone_question', 'like', `${TOKEN}%`).execute();
      await db.db.deleteFrom('knowledge_gaps').where('organization_id', '=', ORG_A).where('title', 'like', `${TOKEN}%`).execute();
    });
    await db.db.deleteFrom('memberships').where('user_id', 'in', [USER_A2, USER_B]).execute();
    await db.db.deleteFrom('organizations').where('id', '=', ORG_B).execute(); // cascades B gaps/signals/kb/logs
    await db.db.deleteFrom('users').where('id', 'in', [USER_A2, USER_B]).execute();
    await db.onModuleDestroy();
  });

  it('does NOT record a signal when retrieval was strong', async () => {
    const question = q('what is our approved laptop model');
    await record(adminA, question, [{ documentName: 'IT Policy', score: 0.91, pageNumber: 1 }]);
    expect(await signalsFor(ORG_A, question)).toHaveLength(0);
  });

  it('records no_relevant_knowledge when nothing survived retrieval', async () => {
    const question = q('production incident escalation path');
    await record(adminA, question, []);
    const rows = await signalsFor(ORG_A, question);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('no_relevant_knowledge');
    expect(rows[0]!.retrieval_outcome).toBe('no_results');
    expect(rows[0]!.top_score).toBeNull();
  });

  it('records weak_evidence (with near-miss docs) for below-adequacy retrieval', async () => {
    const question = q('client offboarding checklist');
    await record(adminA, question, [
      { documentName: 'Onboarding.pdf', score: 0.31, pageNumber: 2 },
      { documentName: 'Misc.pdf', score: 0.22, pageNumber: null },
    ]);
    const rows = await signalsFor(ORG_A, question);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('weak_evidence');
    expect(Number(rows[0]!.top_score)).toBeCloseTo(0.31, 5);
    const weak = rows[0]!.weak_matches as Array<{ documentName: string }>;
    expect(weak[0]!.documentName).toBe('Onboarding.pdf');
  });

  it('groups similar questions into one gap, keeps unrelated ones separate', async () => {
    await record(adminA, q('how do I get travel reimbursed'), []);
    await record(adminA, q('what is the expense reimbursement policy'), []);
    await record(adminA2, q('can employees claim hotel expenses'), []); // different user, same topic
    await record(adminA, q('where is the vacation policy'), []); // unrelated -> its own gap

    const gaps = await db.runWithTenant(ORG_A, () => service.list(adminA));
    const expense = gaps.find((g) => g.title.includes('travel reimbursed'));
    const vacation = gaps.find((g) => g.title.includes('vacation policy'));
    expect(expense).toBeDefined();
    expect(expense!.occurrenceCount).toBe(3);
    expect(expense!.distinctUsers).toBe(2);
    expect(vacation).toBeDefined();
    expect(vacation!.occurrenceCount).toBe(1);
    expect(vacation!.id).not.toBe(expense!.id);
  });

  it('resolves a gap', async () => {
    const gaps = await db.runWithTenant(ORG_A, () => service.list(adminA));
    const gap = gaps.find((g) => g.title.includes('travel reimbursed'))!;
    await db.runWithTenant(ORG_A, () => service.updateStatus(adminA, gap.id, 'resolved'));
    const detail = await db.runWithTenant(ORG_A, () => service.detail(adminA, gap.id));
    expect(detail.status).toBe('resolved');
    expect(detail.resolvedAt).not.toBeNull();
  });

  it('reopens a resolved gap on recurrence', async () => {
    const before = (await db.runWithTenant(ORG_A, () => service.list(adminA))).find((g) =>
      g.title.includes('travel reimbursed'),
    )!;
    await record(adminA, q('reimburse my client travel costs'), []); // same topic again
    const detail = await db.runWithTenant(ORG_A, () => service.detail(adminA, before.id));
    expect(detail.status).toBe('open'); // resurfaced
    expect(detail.occurrenceCount).toBe(before.occurrenceCount + 1);
  });

  it('keeps an ignored gap muted but still counts recurrences', async () => {
    const gap = (await db.runWithTenant(ORG_A, () => service.list(adminA))).find((g) =>
      g.title.includes('vacation policy'),
    )!;
    await db.runWithTenant(ORG_A, () => service.updateStatus(adminA, gap.id, 'ignored'));
    await record(adminA, q('vacation policy for new hires'), []);
    const detail = await db.runWithTenant(ORG_A, () => service.detail(adminA, gap.id));
    expect(detail.status).toBe('ignored'); // stays muted
    expect(detail.occurrenceCount).toBe(gap.occurrenceCount + 1);
  });

  it('computes org-scoped metrics split by reason', async () => {
    // Org B is empty: seed a few chat logs + gap signals for deterministic numbers.
    await db.runWithTenant(ORG_B, async () => {
      for (let i = 0; i < 4; i++) {
        await db.db
          .insertInto('retrieval_logs')
          .values({ organization_id: ORG_B, knowledge_base_id: kbB, source: 'chat', query: `${TOKEN} q${i}` })
          .execute();
      }
    });
    await record(adminB, q('incident escalation for org b'), []); // no_relevant_knowledge
    await record(adminB, q('another incident escalation'), []); // groups with the above
    await record(adminB, q('offboard a client for org b'), [{ documentName: 'X', score: 0.3, pageNumber: null }]); // weak

    const m = await db.runWithTenant(ORG_B, () => service.metrics(adminB));
    expect(m.totalQuestions).toBe(4);
    expect(m.gapSignals).toBe(3);
    expect(m.signalsByReason).toEqual({ no_relevant_knowledge: 2, weak_evidence: 1 });
    expect(m.gapSignalRate).toBeCloseTo(0.75, 5);
    expect(m.openGaps).toBe(2); // one incident gap (2 signals) + one offboarding gap
  });

  it('isolates gaps across organizations (RLS + scoping)', async () => {
    const aGaps = await db.runWithTenant(ORG_A, () => service.list(adminA));
    const aGapId = aGaps[0]!.id;

    // Org B admin sees only B's gaps, never A's.
    const bGaps = await db.runWithTenant(ORG_B, () => service.list(adminB));
    expect(bGaps.some((g) => g.id === aGapId)).toBe(false);

    // Cross-tenant detail/update on A's gap as B -> not found.
    await expect(db.runWithTenant(ORG_B, () => service.detail(adminB, aGapId))).rejects.toThrow();
    await expect(
      db.runWithTenant(ORG_B, () => service.updateStatus(adminB, aGapId, 'resolved')),
    ).rejects.toThrow();

    // A raw RLS check: as B, A's gap rows are invisible.
    const leaked = await db.runWithTenant(ORG_B, () =>
      db.db.selectFrom('knowledge_gaps').select('id').where('id', '=', aGapId).execute(),
    );
    expect(leaked).toHaveLength(0);
  });
});
