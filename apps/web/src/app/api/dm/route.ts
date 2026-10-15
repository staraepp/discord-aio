import { directMessageInputSchema } from '@aio/core/customize';
import { adminRoute, awaitCommand, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { getMember } from '@/lib/discord';
import { checkEmbed } from '@/lib/schedules';

/** The last DMs sent through the bot, from the audit log. */
export const GET = adminRoute(async ({ guildId }) => {
  const rows = await db().auditLog.findMany({ where: { guildId, action: 'dm.send' }, orderBy: { createdAt: 'desc' }, take: 20 });
  return rows.map((r) => ({ id: r.id, actorId: r.actorId, userId: r.targetId, createdAt: r.createdAt, meta: r.meta }));
});

/** The bot sends the DM; the dashboard only checks the request and waits for the result. */
export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, directMessageInputSchema);
  await checkEmbed(guildId, input.embedId);
  if (!(await getMember(input.userId))) throw new HttpError(422, "That user isn't in the server, so the bot can't DM them.");
  // A DM should go out now or not at all: the bot drops requests that waited too long (bot offline).
  const id = await command(session, 'dm.send', { ...input, requestedAt: Date.now() });
  const result = await awaitCommand(id);
  if (!result) throw new HttpError(504, "The bot didn't answer in time, so the DM may not have gone out. Check Recent DMs below before trying again.");
  if (result.status === 'failed') throw new HttpError(422, result.error ?? "The bot couldn't send that DM.");
  const recipient = (result.result as { recipient?: string } | null)?.recipient;
  return { message: recipient ? `Sent to @${recipient}.` : 'Sent.' };
});
