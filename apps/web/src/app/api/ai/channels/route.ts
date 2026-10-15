import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ guildId }) => {
  const configs = await db().aIChannelConfig.findMany({ where: { guildId }, orderBy: { channelName: 'asc' } });
  const counts = await db().aIIndexedMessage.groupBy({ by: ['channelId'], where: { guildId }, _count: true });
  const byChannel = new Map(counts.map((c) => [c.channelId, c._count]));
  return configs.map((c) => ({ ...c, indexedMessages: byChannel.get(c.channelId) ?? 0 }));
});
