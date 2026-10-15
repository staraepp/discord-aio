import { adminRoute, HttpError } from '@/lib/api';
import { db } from '@/lib/server';

const STATUSES = ['new', 'reviewing', 'accepted', 'denied', 'archived'] as const;

export const GET = adminRoute<{ id: string }>(async ({ req, params, guildId }) => {
  const form = await db().form.findFirst({ where: { id: params.id, guildId }, include: { questions: { orderBy: { position: 'asc' } } } });
  if (!form) throw new HttpError(404, 'Form not found');
  const q = req.nextUrl.searchParams;
  const status = q.get('status');
  const search = q.get('q')?.trim().slice(0, 200);
  const page = Math.max(0, Number(q.get('page') ?? 0) || 0);
  const where = {
    formId: form.id,
    ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as (typeof STATUSES)[number] } : {}),
    ...(search ? { searchText: { contains: search, mode: 'insensitive' as const } } : {}),
  };
  const [items, total] = await Promise.all([
    db().formSubmission.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * 25, take: 25, include: { answers: true } }),
    db().formSubmission.count({ where }),
  ]);
  return { form, total, items };
});
