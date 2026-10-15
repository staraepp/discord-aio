import { editMemory, memoryEditSchema } from '@aio/core/ai';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

export const PATCH = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const patch = await readJson(req, memoryEditSchema);
  const row = await editMemory(db(), { guildId, memoryId: params.id, actorId: session.userId, patch });
  if (!row) throw new HttpError(404, 'Memory not found');
  return row;
});

/** Forget: permanently delete the memory. */
export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const m = await db().aIMemory.findFirst({ where: { id: params.id, guildId } });
  if (!m) throw new HttpError(404, 'Memory not found');
  await db().aIMemory.delete({ where: { id: m.id } });
  await audit(session, { module: 'ai', action: 'memory.forget', targetId: m.id, before: { title: m.title } });
  return { ok: true };
});
