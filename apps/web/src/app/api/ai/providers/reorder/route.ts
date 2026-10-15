import { z } from 'zod';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const { ids } = await readJson(req, z.object({ ids: z.array(z.string().max(40)).max(10) }));
  const rows = await db().aIProviderEncryptedCredential.findMany({ where: { guildId }, select: { id: true } });
  if (rows.length !== ids.length || !rows.every((r) => ids.includes(r.id))) throw new HttpError(409, 'The credential list changed. Refresh and try again.');
  await db().$transaction(ids.map((id, priority) => db().aIProviderEncryptedCredential.update({ where: { id }, data: { priority } })));
  await audit(session, { module: 'ai', action: 'provider.reorder', after: { ids } });
  return { ok: true };
});
