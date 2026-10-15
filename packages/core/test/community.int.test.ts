import { beforeEach, describe, expect, it } from 'vitest';
import { GUILD, hasDb, resetDb, testDb } from './helpers';
import { claimGiveawayEnd, claimReminder, createReminder, dueGiveaways, dueReminders, ReminderLimitError, toggleGiveawayEntry } from '../src/community/index';

describe.skipIf(!hasDb)('community storage', () => {
  beforeEach(resetDb);

  it('toggles giveaway entries and locks them once the giveaway ends', async () => {
    const db = testDb();
    const g = await db.giveaway.create({ data: { guildId: GUILD, channelId: '1'.repeat(18), hostId: 'host', prize: 'Nitro', endsAt: new Date(Date.now() - 1000) } });
    expect(await toggleGiveawayEntry(db, g.id, 'alice')).toEqual({ status: 'entered', entries: 1 });
    expect(await toggleGiveawayEntry(db, g.id, 'bob')).toEqual({ status: 'entered', entries: 2 });
    expect(await toggleGiveawayEntry(db, g.id, 'alice')).toEqual({ status: 'left', entries: 1 });

    expect((await dueGiveaways(db, GUILD, new Date())).map((x) => x.id)).toEqual([g.id]);
    // Two processes racing to end it: exactly one wins.
    const claims = await Promise.all([claimGiveawayEnd(db, g.id, new Date()), claimGiveawayEnd(db, g.id, new Date())]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await toggleGiveawayEntry(db, g.id, 'carol')).toEqual({ status: 'ended', entries: 1 });
    expect(await dueGiveaways(db, GUILD, new Date())).toEqual([]);
  });

  it('keeps members under their reminder limit even with simultaneous requests', async () => {
    const db = testDb();
    const base = { guildId: GUILD, userId: 'alice', channelId: null, originChannelId: '2'.repeat(18), text: 'stretch', remindAt: new Date(Date.now() - 1000), max: 3 };
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => createReminder(db, base)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof ReminderLimitError)).toBe(true);

    const due = await dueReminders(db, GUILD, new Date());
    expect(due).toHaveLength(3);
    expect(await claimReminder(db, due[0]!.id, new Date())).toBe(true);
    expect(await claimReminder(db, due[0]!.id, new Date())).toBe(false);
    // Sent reminders free up room again.
    await expect(createReminder(db, base)).resolves.toBeTruthy();
  });
});
