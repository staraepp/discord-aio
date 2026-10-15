import { DESTRUCTIVE_ACTIONS, honeypotConfigSchema } from '@aio/core/honeypot';
import { adminRoute, audit, command, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { CHANNEL_TYPES } from '@/lib/discord';
import { validateRefs } from '@/lib/validate';

export const GET = adminRoute(async ({ guildId }) => {
  const cfg = await db().honeypotConfig.findUnique({ where: { guildId } });
  const published = await db().persistentPanel.findFirst({ where: { guildId, kind: 'honeypot' } });
  return { config: cfg, published };
});

export const PUT = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, honeypotConfigSchema);
  await validateRefs({ channels: [input.channelId, input.logChannelId], roles: input.exemptRoleIds, channelTypes: [CHANNEL_TYPES.text, CHANNEL_TYPES.announcement] });
  const before = await db().honeypotConfig.findUnique({ where: { guildId } });
  const { confirmDestructive: _confirmed, ...data } = input;
  const actionConfirmedBy = DESTRUCTIVE_ACTIONS.has(input.action) ? session.userId : null;
  const row = await db().honeypotConfig.upsert({ where: { guildId }, create: { guildId, ...data, actionConfirmedBy }, update: { ...data, actionConfirmedBy } });
  await audit(session, { module: 'honeypot', action: 'config.update', before, after: { ...data, actionConfirmedBy } });
  await command(session, 'settings.changed', { module: 'honeypot' });
  return row;
});
