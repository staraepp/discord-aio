import { z } from 'zod';
import { deleteCase, editCase, validateReason } from '@aio/core/moderation';
import { adminRoute, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

function num(n: string): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) throw new HttpError(404, 'Case not found');
  return v;
}

export const PATCH = adminRoute<{ n: string }>(async ({ req, params, session, guildId }) => {
  const body = await readJson(req, z.object({ reason: z.string().min(1).max(1000).optional(), evidence: z.string().max(1000).nullable().optional() }));
  if (body.reason !== undefined) {
    const existing = await db().moderationCase.findUnique({ where: { guildId_caseNumber: { guildId, caseNumber: num(params.n) } } });
    if (!existing || existing.deletedAt) throw new HttpError(404, 'Case not found');
    const check = validateReason(existing.type, body.reason);
    if (!check.ok) throw new HttpError(422, check.message);
  }
  const updated = await editCase(db(), { guildId, caseNumber: num(params.n), editorId: session.userId, ...body });
  if (!updated) throw new HttpError(404, 'Case not found');
  return updated;
});

export const DELETE = adminRoute<{ n: string }>(async ({ params, session, guildId }) => {
  const ok = await deleteCase(db(), { guildId, caseNumber: num(params.n), actorId: session.userId });
  if (!ok) throw new HttpError(404, 'Case not found');
  return { ok: true };
});
