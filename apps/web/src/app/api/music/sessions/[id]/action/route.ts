import { z } from 'zod';
import { adminRoute, audit, awaitCommand, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['skip', 'previous', 'pause', 'resume', 'stop', 'disconnect', 'shuffle', 'clear', 'refresh']) }),
  z.object({ action: z.literal('loop'), arg: z.enum(['off', 'track', 'queue']) }),
  z.object({ action: z.literal('volume'), arg: z.number().int().min(0).max(200).multipleOf(10) }),
  z.object({ action: z.literal('toggle_247'), arg: z.boolean() }),
  z.object({ action: z.literal('filter'), arg: z.string().max(40) }),
  z.object({ action: z.enum(['remove_entry', 'jump_entry']), arg: z.string().max(40) }),
  z.object({ action: z.literal('reorder'), arg: z.array(z.string().max(40)).max(1000) }),
]);

/** Staff music controls from the dashboard; executed by the bot so audio state stays consistent. */
export const POST = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const body = await readJson(req, schema);
  const s = await db().musicSession.findFirst({ where: { id: params.id, guildId } });
  if (!s) throw new HttpError(404, 'Session not found');
  const id = await command(session, 'music.action', { sessionId: s.id, action: body.action, arg: 'arg' in body ? body.arg : undefined });
  await audit(session, { module: 'music', action: `dashboard.${body.action}`, targetId: s.voiceChannelId });
  const result = await awaitCommand(id);
  if (!result) throw new HttpError(503, 'The music player did not respond. Is the bot online?');
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'Action failed.');
  const r = result.result as { ok: boolean; message: string } | null;
  if (r && !r.ok) throw new HttpError(409, r.message);
  return r ?? { ok: true, message: 'Done.' };
});
