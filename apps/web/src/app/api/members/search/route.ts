import { z } from 'zod';
import { adminRoute, HttpError } from '@/lib/api';
import { findMember, searchMembers } from '@/lib/discord';
import { limit } from '@/lib/ratelimit';

const query = z.string().trim().min(1).max(32);

/** Find members by name, or look one up by pasted user ID. */
export const GET = adminRoute(async ({ req, session }) => {
  const q = query.safeParse(req.nextUrl.searchParams.get('q') ?? '');
  if (!q.success) throw new HttpError(422, 'Type part of a name or a user ID.');
  limit('memberSearch', session.userId);
  if (/^\d{17,20}$/.test(q.data)) {
    const m = await findMember(q.data);
    return m ? [m] : [];
  }
  return searchMembers(q.data);
});
