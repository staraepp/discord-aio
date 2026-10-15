import { z } from 'zod';
import { adminRoute, audit, command, HttpError, readJson, snowflake } from '@/lib/api';
import { db } from '@/lib/server';
import { validateRefs } from '@/lib/validate';

export const GET = adminRoute(async ({ guildId }) => db().levelRoleReward.findMany({ where: { guildId }, orderBy: { level: 'asc' } }));

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, z.object({ level: z.number().int().min(1).max(1000), roleId: snowflake }));
  await validateRefs({ roles: [input.roleId] }, [input.roleId]);
  if ((await db().levelRoleReward.count({ where: { guildId } })) >= 100) throw new HttpError(422, 'At most 100 role rewards.');
  const row = await db().levelRoleReward.upsert({ where: { guildId_level_roleId: { guildId, ...input } }, create: { guildId, ...input }, update: {} });
  await audit(session, { module: 'leveling', action: 'reward.add', targetId: row.id, after: input });
  await command(session, 'settings.changed', { module: 'leveling' });
  return row;
});
