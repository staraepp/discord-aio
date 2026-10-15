import { z } from 'zod';
import { submitForm, validateAnswers } from '@aio/core/forms';
import { HttpError, publicRoute, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { loadPublicForm } from '@/lib/forms';
import { limit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/session';
import { turnstileSiteKey, verifyTurnstile } from '@/lib/captcha';

const schema = z.object({ answers: z.record(z.string().max(40), z.unknown()), website: z.string().max(200).optional(), captcha: z.string().max(4096).optional() });

/** Public submission. No Discord login; typed Discord IDs are not verified identity. */
export const POST = publicRoute<{ slug: string }>(async (req, { slug }) => {
  const ip = await clientIp();
  limit('formSubmit', `${ip}:${slug}`);
  const body = await readJson(req, schema);
  const form = await loadPublicForm(slug);
  if (!form) throw new HttpError(404, 'Form not found');
  if (!form.isOpen) throw new HttpError(403, form.closedMessage);
  // Hidden honeypot field: real browsers leave it empty.
  if (body.website) return { ok: true, successMessage: form.successMessage };
  if (turnstileSiteKey() && (await verifyTurnstile(body.captcha, ip, `form-${form.id}`)) !== 'passed') throw new HttpError(400, 'Please complete the CAPTCHA and try again.');
  const result = validateAnswers(form.questions, body.answers);
  if (!result.ok) throw new HttpError(422, 'Please fix the highlighted answers.', Object.entries(result.errors).map(([path, message]) => ({ path, message })));
  const sub = await submitForm(db(), form.id, result.values, form.allowEdit);
  return {
    ok: true,
    successMessage: form.successMessage,
    editConfirmationText: form.allowEdit ? form.editConfirmationText : null,
    editPath: sub.editToken ? `/f/${form.slug}/edit/${sub.editToken}` : null,
  };
});
