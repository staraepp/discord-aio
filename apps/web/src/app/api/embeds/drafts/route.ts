import { z } from 'zod';
import { embedDraftInputSchema, listEmbedDrafts, saveEmbedDraft } from '@aio/core/embeds';
import { adminRoute, readJson } from '@/lib/api';
import { db } from '@/lib/server';

/** The signed-in admin's own unsaved drafts (shared with their `/embed` editor in Discord). */
export const GET = adminRoute(async ({ session, guildId }) => listEmbedDrafts(db(), guildId, session.userId));

const upsertSchema = z.object({ id: z.string().max(40).optional(), draft: embedDraftInputSchema });

/** Autosave: creates a draft, or updates it when `id` is one of the caller's drafts. */
export const POST = adminRoute(async ({ req, session, guildId }) => {
  const { id, draft } = await readJson(req, upsertSchema);
  return saveEmbedDraft(db(), guildId, session.userId, draft, id);
});
