import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '@aio/db';

// ── Giveaways ──

export const MAX_GIVEAWAY_WINNERS = 20;

export const giveawayInputSchema = z.object({
  channelId: z.string().regex(/^\d{17,20}$/, 'Choose a channel'),
  prize: z.string().trim().min(1, 'Say what the prize is').max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  winnerCount: z.number().int().min(1).max(MAX_GIVEAWAY_WINNERS).default(1),
  requiredRoleId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
  durationMs: z.number().int().min(60_000, 'Giveaways last at least 1 minute'),
});
export type GiveawayInput = z.infer<typeof giveawayInputSchema>;

/**
 * Fair random winners: a partial Fisher–Yates shuffle with a cryptographic random source,
 * so every entrant has the same chance and nobody can win twice.
 */
export function pickWinners(userIds: string[], count: number, rand: (max: number) => number = randomInt): string[] {
  const pool = [...new Set(userIds)];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + rand(pool.length - i);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

/** Enter, or leave when already entered. Ended giveaways can't be joined. */
export async function toggleGiveawayEntry(db: Db, giveawayId: string, userId: string): Promise<{ status: 'entered' | 'left' | 'ended' | 'missing'; entries: number }> {
  return db.$transaction(async (tx) => {
    const g = await tx.giveaway.findUnique({ where: { id: giveawayId }, select: { endedAt: true } });
    if (!g) return { status: 'missing' as const, entries: 0 };
    if (g.endedAt) return { status: 'ended' as const, entries: await tx.giveawayEntry.count({ where: { giveawayId } }) };
    const removed = await tx.giveawayEntry.deleteMany({ where: { giveawayId, userId } });
    if (removed.count === 0) await tx.giveawayEntry.create({ data: { giveawayId, userId } });
    return { status: removed.count ? ('left' as const) : ('entered' as const), entries: await tx.giveawayEntry.count({ where: { giveawayId } }) };
  });
}

/** Marks a giveaway as ended exactly once; false when someone else already ended it. */
export async function claimGiveawayEnd(db: Db, giveawayId: string, now: Date): Promise<boolean> {
  const r = await db.giveaway.updateMany({ where: { id: giveawayId, endedAt: null }, data: { endedAt: now } });
  return r.count === 1;
}

export function dueGiveaways(db: Db, guildId: string, now: Date) {
  return db.giveaway.findMany({ where: { guildId, endedAt: null, endsAt: { lte: now } }, orderBy: { endsAt: 'asc' }, take: 10 });
}

// ── Reminders ──

export const MAX_REMINDER_MS = 365 * 24 * 60 * 60 * 1000;

export const reminderInputSchema = z.object({
  text: z.string().trim().min(1, 'Say what to remind you about').max(1000),
  delayMs: z.number().int().min(60_000, 'Reminders need to be at least 1 minute away').max(MAX_REMINDER_MS, 'Reminders can be at most a year away'),
});

export class ReminderLimitError extends Error {
  constructor(readonly max: number) {
    super(`You already have ${max} reminders waiting. Cancel one with /remind cancel first.`);
  }
}

/** Creates a reminder, keeping each member under `max` pending ones (checked atomically). */
export async function createReminder(
  db: Db,
  params: { guildId: string; userId: string; channelId: string | null; originChannelId: string; text: string; remindAt: Date; max: number },
) {
  return db.$transaction(async (tx) => {
    // Serialize per member so two quick commands can't both slip under the limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reminder:${params.guildId}:${params.userId}`}))`;
    const pending = await tx.reminder.count({ where: { guildId: params.guildId, userId: params.userId, sentAt: null } });
    if (pending >= params.max) throw new ReminderLimitError(params.max);
    const { max: _max, ...data } = params;
    return tx.reminder.create({ data });
  });
}

export function dueReminders(db: Db, guildId: string, now: Date) {
  return db.reminder.findMany({ where: { guildId, sentAt: null, remindAt: { lte: now } }, orderBy: { remindAt: 'asc' }, take: 25 });
}

/** Claims a reminder for sending; false when it was already sent or cancelled. */
export async function claimReminder(db: Db, id: string, now: Date): Promise<boolean> {
  const r = await db.reminder.updateMany({ where: { id, sentAt: null }, data: { sentAt: now } });
  return r.count === 1;
}

// ── Starboard ──

/** Does a reaction match the configured emoji (unicode, `<:name:id>` or a bare custom id)? */
export function emojiMatches(setting: string, reaction: { id: string | null; name: string | null }): boolean {
  const custom = /^<a?:\w+:(\d+)>$/.exec(setting)?.[1] ?? (/^\d{17,20}$/.test(setting) ? setting : null);
  if (custom) return reaction.id === custom;
  // Strip variation selectors so ⭐ and ⭐️ count as the same star.
  const bare = (s: string) => s.replace(/️/g, '');
  return reaction.id === null && reaction.name !== null && bare(reaction.name) === bare(setting);
}

export type StarboardAction = 'create' | 'update' | 'delete' | 'none';

/** What to do with the starboard copy after a message's star count changed. */
export function starboardAction(params: { stars: number; threshold: number; hasCopy: boolean }): StarboardAction {
  if (params.stars >= params.threshold) return params.hasCopy ? 'update' : 'create';
  return params.hasCopy ? 'delete' : 'none';
}

// ── Polls ──

/** Discord's limits for native polls. */
export const POLL_LIMITS = { question: 300, answer: 55, minAnswers: 2, maxAnswers: 10 } as const;

/** "Pizza | Tacos | Sushi" (or one per line) → answers, trimmed and de-duplicated. */
export function parsePollAnswers(text: string): { ok: true; answers: string[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  const answers = text
    .split(/\n|\|/)
    .map((a) => a.trim())
    .filter((a) => a && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
  if (answers.length < POLL_LIMITS.minAnswers) return { ok: false, error: 'A poll needs at least 2 different answers. Separate them with `|`, like `Pizza | Tacos`.' };
  if (answers.length > POLL_LIMITS.maxAnswers) return { ok: false, error: `Discord polls can have at most ${POLL_LIMITS.maxAnswers} answers.` };
  const long = answers.find((a) => a.length > POLL_LIMITS.answer);
  if (long) return { ok: false, error: `Each answer can be at most ${POLL_LIMITS.answer} characters (“${long.slice(0, 20)}…” is too long).` };
  return { ok: true, answers };
}
