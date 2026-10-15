import { adminRoute, audit, command, HttpError } from '@/lib/api';
import { db } from '@/lib/server';

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await db().levelRoleReward.findFirst({ where: { id: params.id, guildId } });
  if (!row) throw new HttpError(404, 'Reward not found');
  await db().levelRoleReward.delete({ where: { id: row.id } });
  await audit(session, { module: 'leveling', action: 'reward.remove', targetId: row.id, before: row });
  await command(session, 'settings.changed', { module: 'leveling' });
  return { ok: true };
});
