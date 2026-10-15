import { z } from 'zod';
import { editSubmission, validateAnswers } from '@aio/core/forms';
import { HttpError, publicRoute, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { loadPublicForm } from '@/lib/forms';
import { limit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/session';

const schema = z.object({ token: z.string().min(40).max(64), answers: z.record(z.string().max(40), z.unknown()) });

/** Edit via private link. The token rotates on every save so each link works once. */
export const POST = publicRoute<{ slug: string }>(async (req, { slug }) => {
  limit('formEdit', await clientIp());
  const body = await readJson(req, schema);
  const form = await loadPublicForm(slug);
  if (!form || !form.allowEdit) throw new HttpError(404, 'This edit link is not valid.');
  if (!form.isOpen) throw new HttpError(403, form.closedMessage);
  const result = validateAnswers(form.questions, body.answers);
  if (!result.ok) throw new HttpError(422, 'Please fix the highlighted answers.', Object.entries(result.errors).map(([path, message]) => ({ path, message })));
  const edited = await editSubmission(db(), form.id, body.token, result.values);
  if (!edited.ok) throw new HttpError(404, 'This edit link is no longer valid. It may already have been used.');
  return { ok: true, successMessage: 'Your response was updated.', editConfirmationText: form.editConfirmationText, editPath: `/f/${form.slug}/edit/${edited.newToken}` };
});
