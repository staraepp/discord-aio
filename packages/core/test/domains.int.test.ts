import { beforeEach, describe, expect, it } from 'vitest';
import { GUILD, hasDb, resetDb, snow, testDb } from './helpers';
import { editSubmission, findByEditToken, submitForm } from '../src/forms/index';
import { hashToken } from '../src/crypto/index';
import { createCase, deleteCase, editCase, warnMember, warningCount } from '../src/moderation/index';
import { claimFirstResponder, createTicketRecord, setTicketStatus, takeOver } from '../src/tickets/index';
import { issueAttempt, lookupAttempt, recordAttemptResult, resetMember } from '../src/verification/index';
import { adjustXp } from '../src/leveling/index';
import { getModuleState, setModuleEnabled, updateModuleSettings } from '../src/settings/index';
import { claimNextCommand, completeCommand, enqueueDashboardCommand } from '../src/commands/index';
import { AiService, forgetChannel, handleSourceEdited, indexMessage, invalidateMessages, searchMessages, type IncomingMessage } from '../src/ai/index';
import { aiSettingsSchema } from '../src/settings/schemas';

describe.skipIf(!hasDb)('database-backed domains', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('forms edit tokens', () => {
    async function makeForm(allowEdit: boolean) {
      return testDb().form.create({
        data: { guildId: GUILD, slug: `f-${Math.random().toString(36).slice(2, 8)}`, title: 'F', isOpen: true, allowEdit, questions: { create: [{ position: 0, type: 'short_text', label: 'Name' }] } },
        include: { questions: true },
      });
    }

    it('stores only a hash of the edit token', async () => {
      const form = await makeForm(true);
      const r = await submitForm(testDb(), form.id, { [form.questions[0]!.id]: 'Ada' }, true);
      expect(r.editToken).toBeDefined();
      const row = await testDb().formEditTokenHash.findFirstOrThrow();
      expect(row.tokenHash).toBe(hashToken(r.editToken!));
      expect(JSON.stringify(row)).not.toContain(r.editToken!);
    });

    it('does not issue tokens when editing is disabled', async () => {
      const form = await makeForm(false);
      const r = await submitForm(testDb(), form.id, { [form.questions[0]!.id]: 'Ada' }, false);
      expect(r.editToken).toBeUndefined();
      expect(await testDb().formEditTokenHash.count()).toBe(0);
    });

    it('edits rotate the token (old link stops working) and tokens are form-bound', async () => {
      const form = await makeForm(true);
      const other = await makeForm(true);
      const q = form.questions[0]!.id;
      const { editToken } = await submitForm(testDb(), form.id, { [q]: 'Ada' }, true);
      expect(await findByEditToken(testDb(), other.id, editToken!)).toBeNull();
      expect((await findByEditToken(testDb(), form.id, editToken!))?.answers[0]?.value).toBe('Ada');
      const edited = await editSubmission(testDb(), form.id, editToken!, { [q]: 'Grace' });
      expect(edited.ok).toBe(true);
      expect(await findByEditToken(testDb(), form.id, editToken!)).toBeNull();
      if (edited.ok) expect((await findByEditToken(testDb(), form.id, edited.newToken))?.answers[0]?.value).toBe('Grace');
      expect((await editSubmission(testDb(), form.id, editToken!, { [q]: 'X' })).ok).toBe(false);
      expect(await findByEditToken(testDb(), form.id, 'short')).toBeNull();
    });

    it('rejects concurrent reuse of the same token', async () => {
      const form = await makeForm(true);
      const q = form.questions[0]!.id;
      const { editToken } = await submitForm(testDb(), form.id, { [q]: 'A' }, true);
      const results = await Promise.allSettled([editSubmission(testDb(), form.id, editToken!, { [q]: 'B' }), editSubmission(testDb(), form.id, editToken!, { [q]: 'C' })]);
      const oks = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
      expect(oks).toHaveLength(1);
    });
  });

  describe('moderation cases', () => {
    it('warn requires a reason and returns the updated count without escalation', async () => {
      const target = snow(1);
      await expect(createCase(testDb(), { guildId: GUILD, type: 'warn', targetId: target, moderatorId: snow(2), reason: '' })).rejects.toThrow(/reason/);
      for (let i = 1; i <= 5; i++) {
        const r = await warnMember(testDb(), { guildId: GUILD, targetId: target, moderatorId: snow(2), reason: `reason ${i}` });
        expect(r.warningCount).toBe(i);
      }
      // No automatic timeout/kick/ban cases were created.
      expect(await testDb().moderationCase.count({ where: { type: { not: 'warn' } } })).toBe(0);
    });

    it('numbers cases sequentially and keeps edit history; delete is soft', async () => {
      const a = await createCase(testDb(), { guildId: GUILD, type: 'kick', targetId: snow(1), moderatorId: snow(2), reason: 'first' });
      const b = await createCase(testDb(), { guildId: GUILD, type: 'timeout', targetId: snow(1), moderatorId: snow(2), durationMs: 60_000 });
      expect([a.caseNumber, b.caseNumber]).toEqual([1, 2]);
      await editCase(testDb(), { guildId: GUILD, caseNumber: 1, editorId: snow(3), reason: 'updated reason' });
      expect(await testDb().moderationCaseEdit.count()).toBe(1);
      await expect(editCase(testDb(), { guildId: GUILD, caseNumber: 1, editorId: snow(3), reason: '' })).rejects.toThrow();
      await warnMember(testDb(), { guildId: GUILD, targetId: snow(1), moderatorId: snow(2), reason: 'warned' });
      expect(await deleteCase(testDb(), { guildId: GUILD, caseNumber: 3, actorId: snow(3) })).toBe(true);
      expect(await warningCount(testDb(), GUILD, snow(1))).toBe(0);
      expect(await testDb().moderationCase.count()).toBe(3);
      expect(await testDb().auditLog.count({ where: { module: 'moderation' } })).toBeGreaterThanOrEqual(5);
    });
  });

  describe('tickets', () => {
    it('only one concurrent staff reply wins the first-responder rename; takeover keeps it', async () => {
      const t = await createTicketRecord(testDb(), { guildId: GUILD, typeId: null, openerId: snow(1), channelId: snow(50), answers: [] });
      const results = await Promise.all([claimFirstResponder(testDb(), t.id, snow(2)), claimFirstResponder(testDb(), t.id, snow(3)), claimFirstResponder(testDb(), t.id, snow(4))]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const claimed = await testDb().ticket.findUniqueOrThrow({ where: { id: t.id } });
      const after = await takeOver(testDb(), claimed, snow(9));
      expect(after.handlerId).toBe(snow(9));
      expect(after.firstResponderId).toBe(claimed.firstResponderId);
      expect(after.nameLocked).toBe(true);
    });

    it('close/reopen transitions are atomic and audited', async () => {
      const t = await createTicketRecord(testDb(), { guildId: GUILD, typeId: null, openerId: snow(1), channelId: snow(51), answers: [] });
      expect((await setTicketStatus(testDb(), t, 'closed', snow(2)))?.status).toBe('closed');
      expect(await setTicketStatus(testDb(), t, 'closed', snow(2))).toBeNull();
      expect((await setTicketStatus(testDb(), t, 'open', snow(2)))?.status).toBe('open');
      expect(await testDb().auditLog.count({ where: { module: 'tickets' } })).toBe(3);
    });
  });

  describe('verification', () => {
    it('one-use links: success consumes, replay is rejected', async () => {
      const issued = await issueAttempt(testDb(), { guildId: GUILD, userId: snow(1), ttlMinutes: 15 });
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;
      expect((await lookupAttempt(testDb(), issued.token)).ok).toBe(true);
      expect((await recordAttemptResult(testDb(), { attemptId: issued.attempt.id, passed: true })).status).toBe('success');
      expect(await lookupAttempt(testDb(), issued.token)).toMatchObject({ ok: false, reason: 'used' });
      expect(await recordAttemptResult(testDb(), { attemptId: issued.attempt.id, passed: true })).toMatchObject({ status: 'invalid', reason: 'used' });
      const state = await testDb().verificationCooldown.findFirstOrThrow();
      expect(state).toMatchObject({ failuresInCycle: 0, cyclesFailed: 0, pendingRoleSync: true });
      const row = await testDb().verificationAttempt.findFirstOrThrow();
      expect(row.tokenHash).not.toBe(issued.token);
    });

    it('concurrent submissions of the same link succeed at most once', async () => {
      const issued = await issueAttempt(testDb(), { guildId: GUILD, userId: snow(1), ttlMinutes: 15 });
      if (!issued.ok) throw new Error('issue failed');
      const r = await Promise.all([1, 2, 3].map(() => recordAttemptResult(testDb(), { attemptId: issued.attempt.id, passed: true })));
      expect(r.filter((x) => x.status === 'success')).toHaveLength(1);
    });

    it('expired links are rejected', async () => {
      const issued = await issueAttempt(testDb(), { guildId: GUILD, userId: snow(1), ttlMinutes: 15, now: new Date(Date.now() - 60 * 60_000) });
      if (!issued.ok) throw new Error('issue failed');
      expect(await lookupAttempt(testDb(), issued.token)).toMatchObject({ ok: false, reason: 'expired' });
    });

    it('three failures start a verification-only cooldown that escalates; staff reset clears it', async () => {
      const user = snow(1);
      const cooldowns: number[] = [];
      let now = new Date('2026-09-26T00:00:00Z');
      for (let cycle = 0; cycle < 5; cycle++) {
        const issued = await issueAttempt(testDb(), { guildId: GUILD, userId: user, ttlMinutes: 15, now });
        if (!issued.ok) throw new Error(`unexpected ${issued.reason}`);
        let last;
        for (let i = 0; i < 3; i++) last = await recordAttemptResult(testDb(), { attemptId: issued.attempt.id, passed: false, now });
        expect(last!.status).toBe('cooldown');
        if (last!.status === 'cooldown') cooldowns.push(last!.cooldownMs);
        const blocked = await issueAttempt(testDb(), { guildId: GUILD, userId: user, ttlMinutes: 15, now });
        expect(blocked).toMatchObject({ ok: false, reason: 'cooldown' });
        now = new Date(now.getTime() + 7 * 60 * 60_000); // after the cooldown, and outside the issue rate window
      }
      expect(cooldowns).toEqual([300_000, 900_000, 3_600_000, 21_600_000, 21_600_000]);
      await resetMember(testDb(), { guildId: GUILD, userId: user, actorId: snow(9) });
      const state = await testDb().verificationCooldown.findFirstOrThrow();
      expect(state).toMatchObject({ failuresInCycle: 0, cyclesFailed: 0, cooldownUntil: null, verifiedAt: null });
      expect(await testDb().auditLog.count({ where: { action: 'verification.reset' } })).toBe(1);
      // Nothing in the verification flow ever creates kick/timeout moderation cases.
      expect(await testDb().moderationCase.count()).toBe(0);
    });

    it('issuing a new link supersedes the old one and issuance is rate limited', async () => {
      const first = await issueAttempt(testDb(), { guildId: GUILD, userId: snow(1), ttlMinutes: 15 });
      const second = await issueAttempt(testDb(), { guildId: GUILD, userId: snow(1), ttlMinutes: 15 });
      if (!first.ok || !second.ok) throw new Error('issue failed');
      expect(await lookupAttempt(testDb(), first.token)).toMatchObject({ ok: false, reason: 'used' });
      for (let i = 0; i < 3; i++) await issueAttempt(testDb(), { guildId: GUILD, userId: snow(1), ttlMinutes: 15 });
      expect(await issueAttempt(testDb(), { guildId: GUILD, userId: snow(1), ttlMinutes: 15 })).toMatchObject({ ok: false, reason: 'rate_limited' });
    });
  });

  describe('platform services', () => {
    it('module toggles and settings are validated and audited', async () => {
      expect((await getModuleState(testDb(), GUILD, 'tickets')).enabled).toBe(false);
      await setModuleEnabled(testDb(), GUILD, 'tickets', true, snow(1));
      expect((await getModuleState(testDb(), GUILD, 'tickets')).enabled).toBe(true);
      const bad = await updateModuleSettings(testDb(), GUILD, 'music', { panelIntervalSec: 30 }, snow(1));
      expect(bad.ok).toBe(false);
      const good = await updateModuleSettings(testDb(), GUILD, 'music', { panelIntervalSec: 12 }, snow(1));
      expect(good.ok && good.settings.panelIntervalSec).toBe(12);
      expect(await testDb().auditLog.count()).toBe(2);
    });

    it('dashboard commands are claimed exactly once', async () => {
      await enqueueDashboardCommand(testDb(), { guildId: GUILD, type: 'commands.sync', payload: {}, createdBy: snow(1) });
      const claims = await Promise.all([claimNextCommand(testDb()), claimNextCommand(testDb())]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await completeCommand(testDb(), claims.find(Boolean)!.id, true, { ok: 1 });
      expect((await testDb().dashboardCommand.findFirstOrThrow()).status).toBe('done');
    });

    it('XP adjustments are atomic and recompute levels', async () => {
      const s = { formula: 'quadratic' as const, difficulty: 1 };
      await Promise.all(Array.from({ length: 10 }, () => adjustXp(testDb(), { guildId: GUILD, userId: snow(1), delta: 20, settings: s, countMessage: true })));
      const p = await testDb().levelProfile.findFirstOrThrow();
      expect(p.xp).toBe(200);
      expect(p.level).toBe(1);
      expect(p.messageCount).toBe(10);
      const r = await adjustXp(testDb(), { guildId: GUILD, userId: snow(1), set: 0, settings: s });
      expect(r).toMatchObject({ xp: 0, level: 0, leveledUp: false });
    });
  });

  describe('AI context, retrieval and deletion safety', () => {
    const PUB = snow(100);
    const STAFF = snow(101);
    const NOT_ALLOWED = snow(102);
    const OUT = snow(103);
    const msg = (id: number, channelId: string, content: string, extra: Partial<IncomingMessage> = {}): IncomingMessage => ({
      id: snow(1000 + id),
      guildId: GUILD,
      channelId,
      authorId: snow(5),
      authorName: 'ada',
      authorIsBot: false,
      isWebhook: false,
      content,
      createdAt: new Date(),
      jumpUrl: `https://discord.com/channels/${GUILD}/${channelId}/${snow(1000 + id)}`,
      attachments: [],
      ...extra,
    });

    async function seed() {
      const db = testDb();
      await db.aIChannelConfig.create({ data: { guildId: GUILD, channelId: PUB, channelName: 'general' } });
      await db.aIChannelConfig.create({ data: { guildId: GUILD, channelId: STAFF, channelName: 'staff', isPrivate: true, privateConfirmedAt: new Date(), privateConfirmedBy: snow(9) } });
      await indexMessage(db, msg(1, PUB, 'The project codename is Bluebird and launches in March'), false);
      await indexMessage(db, msg(2, STAFF, 'Secret staff note: Bluebird budget is 5000'), false);
      await indexMessage(db, msg(3, NOT_ALLOWED, 'Bluebird leak from an unlisted channel'), false);
    }

    it('full-text search only returns rows from the given eligible channels', async () => {
      await seed();
      const rows = await searchMessages(testDb(), { guildId: GUILD, question: 'what is bluebird?', channelIds: [PUB], limit: 10 });
      expect(rows.map((r) => r.channelId)).toEqual([PUB]);
      const none = await searchMessages(testDb(), { guildId: GUILD, question: 'bluebird', channelIds: [NOT_ALLOWED], limit: 10 });
      expect(none).toEqual([]); // not allowlisted (no AIChannelConfig) → never searchable
    });

    it('answers cite only permitted sources, never hidden-channel content', async () => {
      await seed();
      let seenPrompt = '';
      const ai = new AiService(testDb(), { AI_DEFAULT_MODEL: 'gemini-3.5-flash-lite' }, null, () => ({
        getKey: () => 'k',
        adapter: () => ({
          id: 'google',
          chat: async (req) => {
            seenPrompt = req.turns.map((t) => t.text).join('\n');
            return { text: 'Bluebird launches in March [S1]. Budget unknown [S2].', inputTokens: 10, outputTokens: 5 };
          },
        }),
      }));
      await testDb().aIProviderEncryptedCredential.create({ data: { guildId: GUILD, provider: 'google', label: 'p', encryptedKey: 'x', keyLast4: 'abcd', chatModel: 'gemini-3.5-flash-lite' } });
      const settings = aiSettingsSchema.parse({ outputChannelId: OUT });
      const vis = { memberCanView: () => true, audienceCanView: (c: string) => c !== STAFF };
      const r = await ai.ask({ guildId: GUILD, outputChannelId: OUT, requesterId: snow(9), requesterName: 'mod', question: 'When does Bluebird launch? budget?', images: [], visibility: vis, channelName: (id) => (id === PUB ? 'general' : 'staff') }, settings);
      expect(r.ok).toBe(true);
      expect(seenPrompt).toContain('Bluebird and launches');
      expect(seenPrompt).not.toContain('5000');
      expect(seenPrompt).not.toContain('leak');
      if (r.ok) {
        expect(r.citations).toHaveLength(1);
        expect(r.citations[0]!.jumpUrl).toContain(PUB);
        expect(r.text).not.toContain('[S2]');
      }
      expect(await testDb().aIUsageLedger.count()).toBe(1);
      expect(await testDb().aIConversationTurn.count()).toBe(1);
    });

    it('deleted sources are removed from retrieval and derived memories are re-evaluated', async () => {
      await seed();
      const db = testDb();
      const m1 = snow(1001);
      const memory = await db.aIMemory.create({ data: { guildId: GUILD, title: 'Bluebird', content: 'Project codename', status: 'learned', sources: { create: [{ messageId: m1, channelId: PUB, jumpUrl: 'x' }] } } });
      const pinned = await db.aIMemory.create({ data: { guildId: GUILD, title: 'Rules', content: 'Be nice', status: 'pinned', createdBy: snow(9), sources: { create: [{ messageId: m1, channelId: PUB, jumpUrl: 'x' }] } } });
      await invalidateMessages(db, [m1]);
      expect(await searchMessages(db, { guildId: GUILD, question: 'bluebird march', channelIds: [PUB], limit: 10 })).toEqual([]);
      expect((await db.aIMemory.findUniqueOrThrow({ where: { id: memory.id } })).status).toBe('archived');
      expect((await db.aIMemory.findUniqueOrThrow({ where: { id: pinned.id } })).status).toBe('pinned');
      expect(await db.aIMemorySource.count()).toBe(0);
    });

    it('edits reindex content and send learned memories back to review', async () => {
      await seed();
      const db = testDb();
      const m1 = snow(1001);
      const memory = await db.aIMemory.create({ data: { guildId: GUILD, title: 'Bluebird', content: 'x', status: 'learned', sources: { create: [{ messageId: m1, channelId: PUB, jumpUrl: 'x' }] } } });
      await handleSourceEdited(db, m1, 'Actually the codename is Nightjar');
      expect(await searchMessages(db, { guildId: GUILD, question: 'nightjar', channelIds: [PUB], limit: 5 })).toHaveLength(1);
      expect(await searchMessages(db, { guildId: GUILD, question: 'bluebird', channelIds: [PUB], limit: 5 })).toHaveLength(0);
      expect((await db.aIMemory.findUniqueOrThrow({ where: { id: memory.id } })).status).toBe('proposed');
    });

    it('forgetting a channel purges its data and config', async () => {
      await seed();
      await forgetChannel(testDb(), GUILD, STAFF, snow(9));
      expect(await testDb().aIIndexedMessage.count({ where: { channelId: STAFF } })).toBe(0);
      expect(await testDb().aIChannelConfig.count({ where: { channelId: STAFF } })).toBe(0);
    });

    it('hard budget stop prevents any provider call', async () => {
      await seed();
      let called = false;
      const ai = new AiService(testDb(), { AI_DEFAULT_MODEL: 'm' }, null, () => ({ getKey: () => 'k', adapter: () => ({ id: 'google', chat: async () => ((called = true), { text: '', inputTokens: 0, outputTokens: 0 }) }) }));
      await testDb().aIProviderEncryptedCredential.create({ data: { guildId: GUILD, provider: 'google', label: 'p', encryptedKey: 'x', keyLast4: 'abcd', chatModel: 'm', priority: 0 } });
      await testDb().aIProviderEncryptedCredential.create({ data: { guildId: GUILD, provider: 'google', label: 'backup', encryptedKey: 'y', keyLast4: 'efgh', chatModel: 'm', priority: 1 } });
      await testDb().aIUsageLedger.create({ data: { guildId: GUILD, provider: 'google', model: 'm', purpose: 'chat', estimatedCostUsd: 10.5, success: true } });
      const r = await ai.ask({ guildId: GUILD, outputChannelId: OUT, requesterId: snow(8), requesterName: 'u', question: 'bluebird?', images: [], visibility: { memberCanView: () => true, audienceCanView: () => true }, channelName: () => 'general' }, aiSettingsSchema.parse({}));
      expect(r).toMatchObject({ ok: false, reason: 'budget_stopped' });
      expect(called).toBe(false);
    });
  });
});
