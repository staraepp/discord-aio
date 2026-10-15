import { z } from 'zod';
import { adminRoute, command, readJson } from '@/lib/api';

const schema = z.object({ kind: z.enum(['tempvc', 'verification', 'ticket', 'rolepanel', 'honeypot']), refId: z.string().max(40) });

export const POST = adminRoute(async ({ req, session }) => {
  const body = await readJson(req, schema);
  await command(session, 'panel.delete', body);
  return { ok: true };
});
