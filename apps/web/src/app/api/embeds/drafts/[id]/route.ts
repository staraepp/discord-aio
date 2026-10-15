import { deleteEmbedDraft } from '@aio/core/embeds';
import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  await deleteEmbedDraft(db(), guildId, session.userId, params.id);
  return { ok: true };
});
