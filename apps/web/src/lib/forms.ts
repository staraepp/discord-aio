import 'server-only';
import type { FormInput } from '@aio/core/forms';
import { db } from './server';

/** Saves a form and its questions, keeping question IDs stable so existing answers stay linked. */
export async function saveForm(guildId: string, input: FormInput, actorId: string, id?: string) {
  const { questions, ...fields } = input;
  return db().$transaction(async (tx) => {
    const form = id ? await tx.form.update({ where: { id }, data: fields }) : await tx.form.create({ data: { ...fields, guildId, createdBy: actorId } });
    const existing = await tx.formQuestion.findMany({ where: { formId: form.id }, select: { id: true } });
    const existingIds = new Set(existing.map((q) => q.id));
    const keep = new Set(questions.map((q) => q.id).filter((qid): qid is string => Boolean(qid && existingIds.has(qid))));
    await tx.formQuestion.deleteMany({ where: { formId: form.id, id: { notIn: [...keep] } } });
    for (const [position, q] of questions.entries()) {
      const data = { position, type: q.type, label: q.label, description: q.description ?? null, required: q.type === 'section' ? false : q.required, options: q.options, validation: q.validation as object };
      if (q.id && keep.has(q.id)) await tx.formQuestion.update({ where: { id: q.id }, data });
      else await tx.formQuestion.create({ data: { ...data, formId: form.id } });
    }
    return tx.form.findUniqueOrThrow({ where: { id: form.id }, include: { questions: { orderBy: { position: 'asc' } } } });
  });
}

export async function loadPublicForm(slug: string) {
  return db().form.findUnique({ where: { slug }, include: { questions: { orderBy: { position: 'asc' } } } });
}
