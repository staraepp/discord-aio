import { z } from 'zod';
import { formInputSchema } from '@aio/core/forms';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { saveForm } from '@/lib/forms';

async function find(id: string, guildId: string) {
  const form = await db().form.findFirst({ where: { id, guildId }, include: { questions: { orderBy: { position: 'asc' } } } });
  if (!form) throw new HttpError(404, 'Form not found');
  return form;
}

export const GET = adminRoute<{ id: string }>(async ({ params, guildId }) => find(params.id, guildId));

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const before = await find(params.id, guildId);
  const input = await readJson(req, formInputSchema);
  const clash = await db().form.findFirst({ where: { slug: input.slug, NOT: { id: before.id } } });
  if (clash) throw new HttpError(409, 'That URL slug is already used by another form.');
  const form = await saveForm(guildId, input, session.userId, before.id);
  await audit(session, {
    module: 'forms',
    action: 'form.update',
    targetId: form.id,
    before: { title: before.title, slug: before.slug, isOpen: before.isOpen, questions: before.questions.length },
    after: { title: form.title, slug: form.slug, isOpen: form.isOpen, questions: form.questions.length },
  });
  return form;
});

/** Quick open/close toggle. */
export const PATCH = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const form = await find(params.id, guildId);
  const { isOpen } = await readJson(req, z.object({ isOpen: z.boolean() }));
  await db().form.update({ where: { id: form.id }, data: { isOpen } });
  await audit(session, { module: 'forms', action: isOpen ? 'form.open' : 'form.close', targetId: form.id });
  return { ok: true };
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const form = await find(params.id, guildId);
  await db().form.delete({ where: { id: form.id } });
  await audit(session, { module: 'forms', action: 'form.delete', targetId: form.id, before: { title: form.title, slug: form.slug } });
  return { ok: true };
});
