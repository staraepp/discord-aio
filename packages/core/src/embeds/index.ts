import { z } from 'zod';
import { messageTemplateSchema, type MessageTemplate } from '@aio/discord-ui';
import type { DbOrTx } from '@aio/db';
import { actionSpecSchema, type ActionSpec } from '../actions/index';

/** Saved embeds are server-wide reusable message templates plus optional component actions. */

export const savedEmbedInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[\w .-]+$/, 'Use letters, numbers, spaces, dots, dashes or underscores'),
    template: messageTemplateSchema,
    componentActions: z.record(z.string().max(40), z.array(actionSpecSchema).max(5)).default({}),
  })
  .superRefine((v, ctx) => {
    const keys = new Set(v.template.components.flat().map((c) => c.key));
    for (const key of Object.keys(v.componentActions)) {
      if (!keys.has(key)) ctx.addIssue({ code: 'custom', path: ['componentActions', key], message: `No component with key "${key}"` });
    }
  });

export type SavedEmbedInput = z.infer<typeof savedEmbedInputSchema>;

export interface LoadedEmbed {
  id: string;
  name: string;
  template: MessageTemplate;
  componentActions: Record<string, ActionSpec[]>;
}

/** Loads and re-validates a saved embed; returns null when missing or invalid. */
export async function loadSavedEmbed(db: DbOrTx, guildId: string, idOrName: string): Promise<LoadedEmbed | null> {
  const row = await db.savedEmbed.findFirst({ where: { guildId, OR: [{ id: idOrName }, { name: idOrName }] } });
  if (!row) return null;
  const template = messageTemplateSchema.safeParse(row.template);
  if (!template.success) return null;
  const actions = z.record(z.string(), z.array(actionSpecSchema)).safeParse(row.componentActions ?? {});
  return { id: row.id, name: row.name, template: template.data, componentActions: actions.success ? actions.data : {} };
}

/** Custom ID for saved-embed components: `tpl:<embedId>:<key>`. */
export function savedEmbedCustomId(embedId: string, key: string): string {
  return `tpl:${embedId}:${key}`;
}

// ── Drafts ──

export const MAX_DRAFTS_PER_USER = 10;
export const DRAFT_RETENTION_DAYS = 30;
const MAX_DRAFT_BYTES = 64 * 1024;

/**
 * Drafts may be half-finished, so they are only checked for shape and size here;
 * full validation happens when the draft is saved as a real embed.
 */
export const embedDraftInputSchema = z
  .object({
    embedId: z.string().max(40).nullable().default(null),
    name: z.string().max(60).default(''),
    template: z.object({ embeds: z.array(z.unknown()).max(10), components: z.array(z.unknown()).max(5) }).passthrough(),
    componentActions: z.record(z.string().max(40), z.array(z.unknown()).max(5)).default({}),
  })
  .refine((v) => JSON.stringify(v).length <= MAX_DRAFT_BYTES, 'This draft is too large.');

export type EmbedDraftInput = z.infer<typeof embedDraftInputSchema>;

/** Creates or updates one of the user's drafts, keeping at most MAX_DRAFTS_PER_USER (oldest dropped). */
export async function saveEmbedDraft(db: DbOrTx, guildId: string, userId: string, input: EmbedDraftInput, draftId?: string): Promise<{ id: string }> {
  const data = { embedId: input.embedId, name: input.name, template: input.template as object, componentActions: input.componentActions as object };
  if (draftId) {
    const updated = await db.embedDraft.updateMany({ where: { id: draftId, guildId, userId }, data });
    if (updated.count > 0) return { id: draftId };
  }
  const row = await db.embedDraft.create({ data: { ...data, guildId, userId } });
  const extra = await db.embedDraft.findMany({ where: { guildId, userId }, orderBy: { updatedAt: 'desc' }, skip: MAX_DRAFTS_PER_USER, select: { id: true } });
  if (extra.length) await db.embedDraft.deleteMany({ where: { id: { in: extra.map((d) => d.id) } } });
  return row;
}

export function listEmbedDrafts(db: DbOrTx, guildId: string, userId: string) {
  return db.embedDraft.findMany({ where: { guildId, userId }, orderBy: { updatedAt: 'desc' }, take: MAX_DRAFTS_PER_USER });
}

export async function getEmbedDraft(db: DbOrTx, guildId: string, userId: string, id: string) {
  return db.embedDraft.findFirst({ where: { id, guildId, userId } });
}

export async function deleteEmbedDraft(db: DbOrTx, guildId: string, userId: string, id: string): Promise<void> {
  await db.embedDraft.deleteMany({ where: { id, guildId, userId } });
}

export async function pruneEmbedDrafts(db: DbOrTx, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DRAFT_RETENTION_DAYS * 86_400_000);
  return (await db.embedDraft.deleteMany({ where: { updatedAt: { lt: cutoff } } })).count;
}
