import { z } from 'zod';
import { forgetChannel } from '@aio/core/ai';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { CHANNEL_TYPES, getResources } from '@/lib/discord';

const schema = z.object({
  collect: z.boolean(),
  searchable: z.boolean(),
  attachments: z.boolean(),
  learnMemory: z.boolean(),
  historyDepth: z.number().int().min(0).max(5000),
  citationPriority: z.number().int().min(-10).max(10),
  /** Required to index a channel that @everyone cannot see (explicit admin confirmation). */
  confirmPrivate: z.boolean().default(false),
});

function checkId(id: string) {
  if (!/^\d{17,20}$/.test(id)) throw new HttpError(404, 'Unknown channel');
}

export const PUT = adminRoute<{ channelId: string }>(async ({ req, params, session, guildId }) => {
  checkId(params.channelId);
  const body = await readJson(req, schema);
  let channel: { name: string; type: number; everyoneCanView: boolean } | undefined;
  try {
    channel = (await getResources()).channels.find((c) => c.id === params.channelId);
  } catch {
    throw new HttpError(503, 'Discord data is unavailable, so channel privacy cannot be checked. Try again when the bot token works.');
  }
  if (!channel) throw new HttpError(422, 'That channel is not in this server.');
  if (![CHANNEL_TYPES.text, CHANNEL_TYPES.announcement, CHANNEL_TYPES.forum, CHANNEL_TYPES.voice].includes(channel.type as 0)) throw new HttpError(422, 'Only text-based channels can be used as AI context.');
  const isPrivate = !channel.everyoneCanView;
  const existing = await db().aIChannelConfig.findUnique({ where: { guildId_channelId: { guildId, channelId: params.channelId } } });
  const alreadyConfirmed = Boolean(existing?.privateConfirmedAt && existing.isPrivate);
  if (isPrivate && body.collect && !alreadyConfirmed && !body.confirmPrivate)
    throw new HttpError(422, `#${channel.name} is hidden from @everyone. Confirm that answers may use it. They are still only shown to members who can see it.`, [{ path: 'confirmPrivate', message: 'Confirmation required for private channels.' }]);
  const { confirmPrivate, ...data } = body;
  const confirm = isPrivate && (confirmPrivate || alreadyConfirmed) ? { privateConfirmedBy: existing?.privateConfirmedBy ?? session.userId, privateConfirmedAt: existing?.privateConfirmedAt ?? new Date() } : { privateConfirmedBy: null, privateConfirmedAt: null };
  const row = await db().aIChannelConfig.upsert({
    where: { guildId_channelId: { guildId, channelId: params.channelId } },
    create: { guildId, channelId: params.channelId, channelName: channel.name, isPrivate, ...data, ...confirm },
    update: { channelName: channel.name, isPrivate, ...data, ...confirm },
  });
  await audit(session, { module: 'ai', action: existing ? 'context.update' : 'context.add', targetId: params.channelId, before: existing, after: row });
  await command(session, 'ai.reclassify');
  return row;
});

/** Remove a channel from context and delete everything indexed from it. */
export const DELETE = adminRoute<{ channelId: string }>(async ({ params, session, guildId }) => {
  checkId(params.channelId);
  const res = await forgetChannel(db(), guildId, params.channelId, session.userId);
  return { ok: true, deleted: res.deleted };
});
