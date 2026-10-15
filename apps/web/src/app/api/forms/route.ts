import { formInputSchema } from '@aio/core/forms';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { saveForm } from '@/lib/forms';

export const GET = adminRoute(async ({ guildId }) => {
  const forms = await db().form.findMany({ where: { guildId }, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { submissions: true, questions: true } } } });
  const newCounts = await db().formSubmission.groupBy({ by: ['formId'], where: { status: 'new', form: { guildId } }, _count: true });
  const byForm = new Map(newCounts.map((c) => [c.formId, c._count]));
  return forms.map((f) => ({ ...f, newResponses: byForm.get(f.id) ?? 0 }));
});

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, formInputSchema);
  if (await db().form.findUnique({ where: { slug: input.slug } })) throw new HttpError(409, 'That URL slug is already used by another form.');
  const form = await saveForm(guildId, input, session.userId);
  await audit(session, { module: 'forms', action: 'form.create', targetId: form.id, after: { title: form.title, slug: form.slug } });
  return form;
});
