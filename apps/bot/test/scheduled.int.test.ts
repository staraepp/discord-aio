import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUILD, hasDb, resetDb, testDb } from '../../../packages/core/test/helpers';
import { tickScheduledMessages } from '../src/modules/messages/index';

const CHANNEL = '444444444444444444';

function fakeCtx() {
  const sent: unknown[] = [];
  const me = { id: '1'.repeat(18), displayName: 'Bot', user: { id: '1'.repeat(18), username: 'bot' }, displayAvatarURL: () => '', guild: null as unknown };
  const channel = { id: CHANNEL, name: 'general', isTextBased: () => true, isDMBased: () => false, permissionsFor: () => ({ has: () => true }), send: vi.fn(async (o: unknown) => (sent.push(o), { id: 'm' })) };
  const guild = { id: GUILD, name: 'Server', memberCount: 3, iconURL: () => null, members: { me }, channels: { cache: new Map([[CHANNEL, channel]]) } };
  me.guild = guild;
  const ctx = { guildId: GUILD, db: testDb(), requireGuild: () => guild, log: { warn: vi.fn() } };
  return { ctx: ctx as never, sent };
}

describe.skipIf(!hasDb)('scheduled messages', () => {
  beforeEach(resetDb);

  it('sends a due message once, books the next run, and never double-posts', async () => {
    const { ctx, sent } = fakeCtx();
    const due = new Date('2026-09-27T12:30:00Z');
    await testDb().scheduledMessage.create({ data: { guildId: GUILD, name: 'hi', channelId: CHANNEL, content: 'Good morning {server.name}', schedule: { kind: 'daily', time: '09:30' }, timezone: 'America/Sao_Paulo', nextRunAt: due } });
    const now = new Date('2026-09-27T12:30:20Z');
    await Promise.all([tickScheduledMessages(ctx, now), tickScheduledMessages(ctx, now)]);
    expect(sent).toEqual([{ content: 'Good morning Server', allowedMentions: { parse: [] } }]);
    const row = await testDb().scheduledMessage.findFirstOrThrow();
    expect(row.nextRunAt?.toISOString()).toBe('2026-09-28T12:30:00.000Z');
    expect(row.runCount).toBe(1);
  });

  it('skips a daily run that is hours late instead of posting at a strange time', async () => {
    const { ctx, sent } = fakeCtx();
    await testDb().scheduledMessage.create({ data: { guildId: GUILD, name: 'hi', channelId: CHANNEL, content: 'hi', schedule: { kind: 'daily', time: '09:30' }, timezone: 'UTC', nextRunAt: new Date('2026-09-27T09:30:00Z') } });
    await tickScheduledMessages(ctx, new Date('2026-09-27T15:00:00Z'));
    expect(sent).toHaveLength(0);
    const row = await testDb().scheduledMessage.findFirstOrThrow();
    expect(row.lastError).toMatch(/offline/);
    expect(row.nextRunAt?.toISOString()).toBe('2026-09-28T09:30:00.000Z');
  });

  it('turns a one-time message off after it runs', async () => {
    const { ctx, sent } = fakeCtx();
    const at = '2026-09-27T10:00:00Z';
    await testDb().scheduledMessage.create({ data: { guildId: GUILD, name: 'once', channelId: CHANNEL, content: 'launch', schedule: { kind: 'once', at }, timezone: 'UTC', nextRunAt: new Date(at) } });
    await tickScheduledMessages(ctx, new Date('2026-09-27T10:00:05Z'));
    expect(sent).toHaveLength(1);
    const row = await testDb().scheduledMessage.findFirstOrThrow();
    expect(row).toMatchObject({ enabled: false, nextRunAt: null });
  });
});
