import { z } from 'zod';
import { adminRoute, awaitCommand, command, HttpError, readJson } from '@/lib/api';
import { assertGuildIds, CHANNEL_TYPES } from '@/lib/discord';

const schema = z.object({
  kind: z.enum(['tempvc', 'verification', 'ticket', 'rolepanel', 'honeypot']),
  refId: z.string().max(40).optional(),
  channelId: z.string().regex(/^\d{17,20}$/).optional(),
});

export const POST = adminRoute(async ({ req, session }) => {
  const body = await readJson(req, schema);
  if ((body.kind === 'ticket' || body.kind === 'rolepanel') && (!body.refId || !body.channelId)) throw new HttpError(422, 'Choose a channel to publish to.');
  if (body.channelId) {
    const problem = await assertGuildIds({ channels: [body.channelId], channelTypes: [CHANNEL_TYPES.text, CHANNEL_TYPES.announcement] });
    if (problem) throw new HttpError(422, problem);
  }
  const id = await command(session, 'panel.publish', body);
  const result = await awaitCommand(id);
  if (!result) return { queued: true, message: 'Queued. The bot will publish the panel when it is online.' };
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'The bot could not publish the panel.');
  return { queued: false, message: 'Published.', result: result.result };
});
