import { botProfileSchema, getBotProfile, REPLY_CATALOG } from '@aio/core/customize';
import { adminRoute, audit, command, readJson } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ guildId }) => ({ profile: await getBotProfile(db(), guildId), replies: REPLY_CATALOG }));

export const PUT = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, botProfileSchema);
  const before = await getBotProfile(db(), guildId);
  await db().guildConfig.upsert({ where: { id: guildId }, create: { id: guildId, botProfile: input as object }, update: { botProfile: input as object } });
  await audit(session, { module: 'core', action: 'profile.update', before, after: input });
  await command(session, 'settings.changed');
  // Applies the nickname right away; statuses pick up the change on their next rotation.
  await command(session, 'profile.apply');
  return input;
});
