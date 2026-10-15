import { z } from 'zod';
import { adminRoute, awaitCommand, command, HttpError, readJson, snowflake } from '@/lib/api';
import { db } from '@/lib/server';
import { CHANNEL_TYPES } from '@/lib/discord';
import { validateRefs } from '@/lib/validate';

export const POST = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const { channelId } = await readJson(req, z.object({ channelId: snowflake }));
  const row = await db().savedEmbed.findFirst({ where: { id: params.id, guildId } });
  if (!row) throw new HttpError(404, 'Saved embed not found');
  await validateRefs({ channels: [channelId], channelTypes: [CHANNEL_TYPES.text, CHANNEL_TYPES.announcement] });
  const id = await command(session, 'embed.send', { embedId: row.id, channelId });
  const result = await awaitCommand(id);
  if (!result) return { queued: true, message: 'Queued. The bot will send it when it is online.' };
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'The bot could not send the message.');
  return { queued: false, message: 'Sent.' };
});
