import { z } from 'zod';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

async function find(formId: string, rid: string, guildId: string) {
  const row = await db().formSubmission.findFirst({ where: { id: rid, formId, form: { guildId } } });
  if (!row) throw new HttpError(404, 'Response not found');
  return row;
}

export const PATCH = adminRoute<{ id: string; rid: string }>(async ({ req, params, session, guildId }) => {
  const row = await find(params.id, params.rid, guildId);
  const body = await readJson(req, z.object({ status: z.enum(['new', 'reviewing', 'accepted', 'denied', 'archived']).optional(), adminNotes: z.string().max(5000).nullable().optional() }));
  const updated = await db().formSubmission.update({ where: { id: row.id }, data: body });
  // Private notes are never written into the audit log, only the fact that they changed.
  await audit(session, { module: 'forms', action: 'response.update', targetId: row.id, before: { status: row.status }, after: { status: updated.status }, meta: { notesChanged: body.adminNotes !== undefined } });
  return updated;
});

export const DELETE = adminRoute<{ id: string; rid: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, params.rid, guildId);
  await db().formSubmission.delete({ where: { id: row.id } });
  await audit(session, { module: 'forms', action: 'response.delete', targetId: row.id });
  return { ok: true };
});
