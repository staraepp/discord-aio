import { adminRoute, HttpError } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute<{ id: string }>(async ({ params, guildId }) => {
  const row = await db().dashboardCommand.findFirst({ where: { id: params.id, guildId }, select: { id: true, type: true, status: true, result: true, error: true, createdAt: true, processedAt: true } });
  if (!row) throw new HttpError(404, 'Not found');
  return row;
});
