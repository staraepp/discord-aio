import { NextResponse } from 'next/server';
import { toCsv } from '@aio/core/forms';
import { adminRoute, audit, HttpError } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const form = await db().form.findFirst({ where: { id: params.id, guildId }, include: { questions: { orderBy: { position: 'asc' } } } });
  if (!form) throw new HttpError(404, 'Form not found');
  const subs = await db().formSubmission.findMany({ where: { formId: form.id }, orderBy: { createdAt: 'asc' }, include: { answers: true }, take: 50_000 });
  await audit(session, { module: 'forms', action: 'responses.export', targetId: form.id, meta: { count: subs.length } });
  return new NextResponse(`\uFEFF${toCsv(form.questions, subs)}`, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${form.slug}-responses.csv"`, 'Cache-Control': 'no-store' },
  });
});
