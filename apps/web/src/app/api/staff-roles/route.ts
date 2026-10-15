import { z } from 'zod';
import { getStaffRoles } from '@aio/core';
import { adminRoute, audit, command, HttpError, readJson, snowflake } from '@/lib/api';
import { db } from '@/lib/server';
import { assertGuildIds } from '@/lib/discord';

const schema = z.object({
  staffRoleIds: z.array(snowflake).max(25),
  musicStaffRoleIds: z.array(snowflake).max(25),
  ticketStaffRoleIds: z.array(snowflake).max(25),
  auditLogChannelId: snowflake.nullable().optional(),
});

export const GET = adminRoute(async ({ guildId }) => {
  const cfg = await db().guildConfig.findUnique({ where: { id: guildId } });
  return { ...(await getStaffRoles(db(), guildId)), auditLogChannelId: cfg?.auditLogChannelId ?? null };
});

export const PUT = adminRoute(async ({ req, session, guildId }) => {
  const body = await readJson(req, schema);
  const problem = await assertGuildIds({ roles: [...body.staffRoleIds, ...body.musicStaffRoleIds, ...body.ticketStaffRoleIds], channels: [body.auditLogChannelId] });
  if (problem) throw new HttpError(422, problem);
  const before = await db().guildConfig.findUnique({ where: { id: guildId } });
  const data = { staffRoleIds: body.staffRoleIds, musicStaffRoleIds: body.musicStaffRoleIds, ticketStaffRoleIds: body.ticketStaffRoleIds, auditLogChannelId: body.auditLogChannelId ?? null };
  await db().guildConfig.upsert({ where: { id: guildId }, create: { id: guildId, ...data }, update: data });
  await audit(session, { module: 'dashboard', action: 'staff_roles.update', before, after: data });
  await command(session, 'settings.changed', { module: 'core' });
  return data;
});
