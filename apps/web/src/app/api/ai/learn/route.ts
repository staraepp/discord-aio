import { adminRoute, command } from '@/lib/api';

export const POST = adminRoute(async ({ session }) => {
  await command(session, 'ai.learn_now');
  return { ok: true, message: 'Learning run queued. New memories appear here when it finishes.' };
});
