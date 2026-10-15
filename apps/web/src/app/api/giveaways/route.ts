import { giveawayInputSchema } from '@aio/core/community';
import { adminRoute, awaitCommand, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { CHANNEL_TYPES } from '@/lib/discord';
import { validateRefs } from '@/lib/validate';

export const GET = adminRoute(async ({ guildId }) => {
  const rows = await db().giveaway.findMany({ where: { guildId }, orderBy: [{ endedAt: { sort: 'desc', nulls: 'first' } }, { endsAt: 'asc' }], take: 50, include: { _count: { select: { entries: true } } } });
  return rows.map(({ _count, ...g }) => ({ ...g, entries: _count.entries }));
});

/** The bot posts the giveaway; the dashboard only records the request. */
export const POST = adminRoute(async ({ req, session }) => {
  const input = await readJson(req, giveawayInputSchema);
  await validateRefs({ channels: [input.channelId], roles: [input.requiredRoleId], channelTypes: [CHANNEL_TYPES.text, CHANNEL_TYPES.announcement] });
  const id = await command(session, 'giveaway.start', input);
  const result = await awaitCommand(id);
  if (!result) return { queued: true, message: 'Queued. The bot will post the giveaway when it is online.' };
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'The bot could not start the giveaway.');
  return { queued: false, message: 'Giveaway started.' };
});
