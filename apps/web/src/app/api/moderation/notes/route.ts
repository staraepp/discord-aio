import { adminRoute, HttpError } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ req, guildId }) => {
  const target = req.nextUrl.searchParams.get('target');
  if (!target || !/^\d{17,20}$/.test(target)) throw new HttpError(422, 'Enter a user ID.');
  return db().moderationNote.findMany({ where: { guildId, targetId: target }, orderBy: { createdAt: 'desc' }, take: 100 });
});
