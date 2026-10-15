import { z } from 'zod';
import { MAX_GIVEAWAY_WINNERS } from '@aio/core/community';
import { adminRoute, awaitCommand, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('end') }), z.object({ action: z.literal('reroll'), count: z.number().int().min(1).max(MAX_GIVEAWAY_WINNERS).default(1) })]);

export const POST = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const body = await readJson(req, schema);
  const g = await db().giveaway.findFirst({ where: { id: params.id, guildId } });
  if (!g) throw new HttpError(404, 'That giveaway no longer exists.');
  if (body.action === 'end' && g.endedAt) throw new HttpError(409, 'That giveaway already ended.');
  if (body.action === 'reroll' && !g.endedAt) throw new HttpError(409, "That giveaway hasn't ended yet.");
  const id = await command(session, body.action === 'end' ? 'giveaway.end' : 'giveaway.reroll', { id: g.id, count: body.action === 'reroll' ? body.count : undefined });
  const result = await awaitCommand(id);
  if (!result) return { queued: true, message: 'Queued. The bot will do this when it is online.' };
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'The bot could not do that.');
  const winners = ((result.result as { winners?: string[] } | null)?.winners ?? []).length;
  return { queued: false, message: body.action === 'end' ? (winners ? `Ended and drew ${winners} winner${winners === 1 ? '' : 's'}.` : 'Ended. Nobody eligible had entered.') : winners ? `Picked ${winners} new winner${winners === 1 ? '' : 's'}.` : 'Everyone eligible has already won.' };
});
