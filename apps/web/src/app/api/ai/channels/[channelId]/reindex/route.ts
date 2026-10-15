import { adminRoute, awaitCommand, command, HttpError } from '@/lib/api';
import { db } from '@/lib/server';

export const POST = adminRoute<{ channelId: string }>(async ({ params, session, guildId }) => {
  const cfg = await db().aIChannelConfig.findUnique({ where: { guildId_channelId: { guildId, channelId: params.channelId } } });
  if (!cfg) throw new HttpError(404, 'Channel is not configured for AI context.');
  if (cfg.historyDepth === 0) throw new HttpError(422, 'Set a history depth above 0 to import older messages.');
  const id = await command(session, 'ai.reindex_channel', { channelId: cfg.channelId });
  const result = await awaitCommand(id, 20_000);
  if (!result) return { queued: true, message: 'Indexing continues in the background.' };
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'Indexing failed.');
  return { queued: false, message: `Indexed ${(result.result as { indexed?: number } | null)?.indexed ?? 0} messages.` };
});
