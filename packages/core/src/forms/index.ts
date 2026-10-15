import { z } from 'zod';
import type { Db, FormQuestion } from '@aio/db';
import { generateToken, hashToken } from '../crypto/index';

/** Public forms (no Discord login). Typed Discord IDs are NOT verified identity. */

export const QUESTION_TYPES = ['section', 'short_text', 'long_text', 'single_choice', 'multiple_choice', 'dropdown', 'checkbox', 'number', 'date'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const questionValidationSchema = z
  .object({
    minLength: z.number().int().min(0).max(10000).optional(),
    maxLength: z.number().int().min(1).max(10000).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
    pattern: z.enum(['email', 'url', 'discord_id', 'discord_username']).optional(),
    minSelected: z.number().int().min(0).max(50).optional(),
    maxSelected: z.number().int().min(1).max(50).optional(),
  })
  .default({});

export const questionInputSchema = z
  .object({
    id: z.string().max(40).optional(),
    type: z.enum(QUESTION_TYPES),
    label: z.string().min(1).max(300),
    description: z.string().max(1000).optional().nullable(),
    required: z.boolean().default(false),
    options: z.array(z.string().min(1).max(200)).max(50).default([]),
    validation: questionValidationSchema,
  })
  .superRefine((q, ctx) => {
    const needsOptions = q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'dropdown';
    if (needsOptions && q.options.length < 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option.' });
    if (new Set(q.options).size !== q.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Options must be unique.' });
  });

export const formInputSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes'),
  description: z.string().max(4000).default(''),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#5865f2'),
  isOpen: z.boolean().default(false),
  closedMessage: z.string().max(1000).default('This form is currently closed.'),
  successMessage: z.string().max(2000).default('Thanks! Your response has been recorded.'),
  allowEdit: z.boolean().default(false),
  editConfirmationText: z.string().max(1000).default("Save this private link if you want to edit your response later. Don't share it."),
  questions: z.array(questionInputSchema).max(100).default([]),
});

export type FormInput = z.infer<typeof formInputSchema>;
export type QuestionValidation = z.infer<typeof questionValidationSchema>;

export type AnswerValue = string | string[] | number | boolean | null;

const PATTERNS: Record<string, { re: RegExp; message: string }> = {
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, message: 'Enter a valid email address.' },
  url: { re: /^https?:\/\/[^\s]+$/i, message: 'Enter a valid http(s) URL.' },
  discord_id: { re: /^\d{17,20}$/, message: 'Discord IDs are 17–20 digits.' },
  discord_username: { re: /^(?!.*\.\.)[a-z0-9_.]{2,32}$/, message: 'Discord usernames are 2–32 lowercase letters, numbers, _ or .' },
};

type QuestionLike = Pick<FormQuestion, 'id' | 'type' | 'label' | 'required' | 'options'> & { validation: unknown };

export function validateAnswers(questions: QuestionLike[], raw: Record<string, unknown>): { ok: true; values: Record<string, AnswerValue> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const values: Record<string, AnswerValue> = {};
  for (const q of questions) {
    if (q.type === 'section') continue;
    const v = questionValidationSchema.parse(q.validation ?? {});
    const input = raw[q.id];
    const empty = input === undefined || input === null || input === '' || (Array.isArray(input) && input.length === 0);
    if (empty) {
      if (q.required && q.type !== 'checkbox') errors[q.id] = 'This question is required.';
      else if (q.required && q.type === 'checkbox') errors[q.id] = 'Please tick this box to continue.';
      values[q.id] = q.type === 'checkbox' ? false : null;
      continue;
    }
    switch (q.type) {
      case 'short_text':
      case 'long_text': {
        if (typeof input !== 'string') {
          errors[q.id] = 'Invalid answer.';
          break;
        }
        const text = input.trim();
        const max = v.maxLength ?? (q.type === 'short_text' ? 300 : 5000);
        if (text.length > max) errors[q.id] = `Must be at most ${max} characters.`;
        else if (v.minLength && text.length < v.minLength) errors[q.id] = `Must be at least ${v.minLength} characters.`;
        else if (v.pattern && !PATTERNS[v.pattern]!.re.test(text)) errors[q.id] = PATTERNS[v.pattern]!.message;
        else values[q.id] = text;
        break;
      }
      case 'single_choice':
      case 'dropdown': {
        if (typeof input !== 'string' || !q.options.includes(input)) errors[q.id] = 'Choose one of the options.';
        else values[q.id] = input;
        break;
      }
      case 'multiple_choice': {
        const arr = Array.isArray(input) ? input : [input];
        if (!arr.every((a) => typeof a === 'string' && q.options.includes(a))) errors[q.id] = 'Choose from the listed options.';
        else if (v.minSelected && arr.length < v.minSelected) errors[q.id] = `Choose at least ${v.minSelected}.`;
        else if (v.maxSelected && arr.length > v.maxSelected) errors[q.id] = `Choose at most ${v.maxSelected}.`;
        else values[q.id] = [...new Set(arr as string[])];
        break;
      }
      case 'checkbox': {
        values[q.id] = input === true || input === 'on' || input === 'true';
        if (q.required && values[q.id] !== true) errors[q.id] = 'Please tick this box to continue.';
        break;
      }
      case 'number': {
        const n = typeof input === 'number' ? input : Number(String(input).trim());
        if (!Number.isFinite(n)) errors[q.id] = 'Enter a number.';
        else if (v.integer && !Number.isInteger(n)) errors[q.id] = 'Enter a whole number.';
        else if (v.min !== undefined && n < v.min) errors[q.id] = `Must be at least ${v.min}.`;
        else if (v.max !== undefined && n > v.max) errors[q.id] = `Must be at most ${v.max}.`;
        else values[q.id] = n;
        break;
      }
      case 'date': {
        const s = String(input);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) errors[q.id] = 'Enter a valid date.';
        else values[q.id] = s;
        break;
      }
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}

function searchTextOf(values: Record<string, AnswerValue>): string {
  return Object.values(values)
    .map((v) => (Array.isArray(v) ? v.join(' ') : v === null ? '' : String(v)))
    .join(' ')
    .slice(0, 10000);
}

export interface SubmitResult {
  submissionId: string;
  /** Raw edit token — shown ONCE on the confirmation page, only its hash is stored. */
  editToken?: string;
}

export async function submitForm(db: Db, formId: string, values: Record<string, AnswerValue>, allowEdit: boolean): Promise<SubmitResult> {
  return db.$transaction(async (tx) => {
    const sub = await tx.formSubmission.create({ data: { formId, searchText: searchTextOf(values) } });
    await tx.formAnswer.createMany({ data: Object.entries(values).map(([questionId, value]) => ({ submissionId: sub.id, questionId, value: value as never })) });
    if (!allowEdit) return { submissionId: sub.id };
    const token = generateToken(32);
    await tx.formEditTokenHash.create({ data: { submissionId: sub.id, tokenHash: hashToken(token) } });
    return { submissionId: sub.id, editToken: token };
  });
}

/** Look up a submission by raw edit token (constant-time via hash lookup). */
export async function findByEditToken(db: Db, formId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const row = await db.formEditTokenHash.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { submission: { include: { answers: true } } },
  });
  if (!row || row.submission.formId !== formId) return null;
  return row.submission;
}

/**
 * Apply an edit and ROTATE the token: the old link stops working and a new
 * private link is shown, so each edit link is single-use.
 */
export async function editSubmission(db: Db, formId: string, token: string, values: Record<string, AnswerValue>): Promise<{ ok: true; newToken: string } | { ok: false }> {
  return db.$transaction(async (tx) => {
    const hash = hashToken(token);
    const row = await tx.formEditTokenHash.findUnique({ where: { tokenHash: hash }, include: { submission: true } });
    if (!row || row.submission.formId !== formId) return { ok: false as const };
    const newToken = generateToken(32);
    // Conditional update guards against concurrent use of the same token.
    const rotated = await tx.formEditTokenHash.updateMany({ where: { id: row.id, tokenHash: hash }, data: { tokenHash: hashToken(newToken), lastUsedAt: new Date() } });
    if (rotated.count !== 1) return { ok: false as const };
    await tx.formAnswer.deleteMany({ where: { submissionId: row.submissionId } });
    await tx.formAnswer.createMany({ data: Object.entries(values).map(([questionId, value]) => ({ submissionId: row.submissionId, questionId, value: value as never })) });
    await tx.formSubmission.update({ where: { id: row.submissionId }, data: { editedAt: new Date(), searchText: searchTextOf(values) } });
    return { ok: true as const, newToken };
  });
}

function csvCell(value: unknown): string {
  let s = Array.isArray(value) ? value.join('; ') : value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  questions: Pick<FormQuestion, 'id' | 'label' | 'type'>[],
  submissions: { id: string; status: string; createdAt: Date; editedAt: Date | null; answers: { questionId: string; value: unknown }[] }[],
): string {
  const qs = questions.filter((q) => q.type !== 'section');
  const header = ['Submission ID', 'Status', 'Submitted at', 'Edited at', ...qs.map((q) => q.label)];
  const rows = submissions.map((s) => {
    const byQ = new Map(s.answers.map((a) => [a.questionId, a.value]));
    return [s.id, s.status, s.createdAt.toISOString(), s.editedAt?.toISOString() ?? '', ...qs.map((q) => byQ.get(q.id))];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
