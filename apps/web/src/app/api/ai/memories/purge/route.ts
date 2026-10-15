import { z } from 'zod';
import { purgeMemories } from '@aio/core/ai';
import { adminRoute, readJson } from '@/lib/api';
import { db } from '@/lib/server';

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const body = await readJson(req, z.object({ includePinned: z.boolean().default(false), confirm: z.literal('PURGE') }));
  const count = await purgeMemories(db(), guildId, session.userId, body.includePinned);
  return { ok: true, count };
});
