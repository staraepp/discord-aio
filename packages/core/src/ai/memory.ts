import { z } from 'zod';
import type { AIChannelConfig, Db, DbOrTx } from '@aio/db';
import { writeAudit } from '../audit/index';

/**
 * Indexing, invalidation and memory lifecycle.
 * Deleted / inaccessible sources are removed so they can never be retrieved,
 * and memories derived from them are re-evaluated.
 */

export const MAX_INDEXED_CONTENT = 4000;

export interface IncomingMessage {
  id: string;
  guildId: string;
  channelId: string;
  /** Parent channel for threads; channel allowlist applies to the parent. */
  parentChannelId?: string | null;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  isWebhook: boolean;
  content: string;
  createdAt: Date;
  jumpUrl: string;
  attachments: { url: string; filename: string; contentType: string | null; size: number }[];
}

/** Only allowlisted channels with collection enabled are ingested. Bots/webhooks are skipped. */
export function shouldIndex(msg: IncomingMessage, config: Pick<AIChannelConfig, 'collect' | 'isPrivate' | 'privateConfirmedAt'> | null | undefined): boolean {
  if (!config || !config.collect) return false;
  if (config.isPrivate && !config.privateConfirmedAt) return false;
  if (msg.authorIsBot || msg.isWebhook) return false;
  return msg.content.trim().length > 0 || msg.attachments.length > 0;
}

function discordCdnExpiry(url: string): Date | null {
  try {
    const ex = new URL(url).searchParams.get('ex');
    return ex ? new Date(parseInt(ex, 16) * 1000) : null;
  } catch {
    return null;
  }
}

export async function indexMessage(db: Db, msg: IncomingMessage, withAttachments: boolean): Promise<void> {
  const content = msg.content.slice(0, MAX_INDEXED_CONTENT);
  await db.$transaction(async (tx) => {
    await tx.aIIndexedMessage.upsert({
      where: { id: msg.id },
      create: { id: msg.id, guildId: msg.guildId, channelId: msg.channelId, authorId: msg.authorId, authorName: msg.authorName.slice(0, 100), content, jumpUrl: msg.jumpUrl, createdAt: msg.createdAt },
      update: { content, authorName: msg.authorName.slice(0, 100), editedAt: new Date() },
    });
    if (withAttachments && msg.attachments.length) {
      await tx.aIAttachmentReference.deleteMany({ where: { messageId: msg.id } });
      await tx.aIAttachmentReference.createMany({
        data: msg.attachments.slice(0, 10).map((a) => ({ messageId: msg.id, url: a.url, filename: a.filename.slice(0, 200), contentType: a.contentType, size: a.size, expiresAt: discordCdnExpiry(a.url) })),
      });
    }
  });
}

/** Source message edited: update index and send derived (non-pinned) memories back to review. */
export async function handleSourceEdited(db: Db, messageId: string, newContent: string): Promise<{ memoriesReopened: number }> {
  return db.$transaction(async (tx) => {
    const exists = await tx.aIIndexedMessage.findUnique({ where: { id: messageId }, select: { id: true } });
    if (!exists) return { memoriesReopened: 0 };
    await tx.aIIndexedMessage.update({ where: { id: messageId }, data: { content: newContent.slice(0, MAX_INDEXED_CONTENT), editedAt: new Date() } });
    const links = await tx.aIMemorySource.findMany({ where: { messageId }, select: { memoryId: true } });
    const res = await tx.aIMemory.updateMany({
      where: { id: { in: links.map((l) => l.memoryId) }, status: 'learned' },
      data: { status: 'proposed', provenance: 'Returned to review: a source message was edited.' },
    });
    await tx.aISummary.updateMany({ where: { sourceMessageIds: { has: messageId }, status: 'active' }, data: { status: 'stale' } });
    return { memoriesReopened: res.count };
  });
}

/**
 * Source deleted or became inaccessible: remove it entirely (no retrieval, no
 * citation), drop memory links, archive AI-derived memories with no remaining
 * evidence, and mark summaries that used it as stale.
 */
export async function invalidateMessages(db: DbOrTx, messageIds: string[]): Promise<{ deleted: number; memoriesArchived: number }> {
  if (messageIds.length === 0) return { deleted: 0, memoriesArchived: 0 };
  const links = await db.aIMemorySource.findMany({ where: { messageId: { in: messageIds } }, select: { memoryId: true } });
  const affected = [...new Set(links.map((l) => l.memoryId))];
  await db.aIMemorySource.deleteMany({ where: { messageId: { in: messageIds } } });
  const deleted = await db.aIIndexedMessage.deleteMany({ where: { id: { in: messageIds } } });
  await db.aISummary.updateMany({ where: { sourceMessageIds: { hasSome: messageIds }, status: 'active' }, data: { status: 'stale' } });
  let archived = 0;
  for (const memoryId of affected) {
    const m = await db.aIMemory.findUnique({ where: { id: memoryId }, include: { _count: { select: { sources: true } } } });
    if (!m || m.status === 'pinned' || m.createdBy !== 'ai') continue;
    if (m._count.sources === 0) {
      await db.aIMemory.update({ where: { id: memoryId }, data: { status: 'archived', provenance: 'Archived automatically: all source messages were deleted or became inaccessible.' } });
      archived++;
    } else if (m.status === 'learned') {
      await db.aIMemory.update({ where: { id: memoryId }, data: { status: 'proposed', provenance: 'Returned to review: some source messages were removed.' } });
    }
  }
  return { deleted: deleted.count, memoriesArchived: archived };
}

/** Forget a channel: delete indexed messages, summaries, memory links and its config. */
export async function forgetChannel(db: Db, guildId: string, channelId: string, actorId: string | null): Promise<{ deleted: number }> {
  return db.$transaction(
    async (tx) => {
      const ids = (await tx.aIIndexedMessage.findMany({ where: { guildId, channelId }, select: { id: true } })).map((m) => m.id);
      const res = await invalidateMessages(tx, ids);
      await tx.aIMemorySource.deleteMany({ where: { channelId } });
      await tx.aISummary.deleteMany({ where: { guildId, channelId } });
      await tx.aIChannelConfig.deleteMany({ where: { guildId, channelId } });
      await writeAudit(tx, { guildId, actorId, actorType: actorId ? 'user' : 'system', module: 'ai', action: 'context.forget_channel', targetId: channelId, meta: { deleted: res.deleted } });
      return { deleted: res.deleted };
    },
    { timeout: 60_000 },
  );
}

export async function purgeMemories(db: Db, guildId: string, actorId: string, includePinned: boolean): Promise<number> {
  const res = await db.aIMemory.deleteMany({ where: { guildId, ...(includePinned ? {} : { status: { not: 'pinned' } }) } });
  await writeAudit(db, { guildId, actorId, module: 'ai', action: 'memory.purge', meta: { count: res.count, includePinned } });
  return res.count;
}

export const memoryEditSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(2000).optional(),
  kind: z.enum(['vocabulary', 'project', 'decision', 'term', 'inside_joke', 'fact']).optional(),
  status: z.enum(['proposed', 'learned', 'pinned', 'archived']).optional(),
});

/** Admin edit. Editing a learned memory keeps history by superseding the old record. */
export async function editMemory(db: Db, params: { guildId: string; memoryId: string; actorId: string; patch: z.infer<typeof memoryEditSchema> }) {
  return db.$transaction(async (tx) => {
    const m = await tx.aIMemory.findFirst({ where: { id: params.memoryId, guildId: params.guildId }, include: { sources: true } });
    if (!m) return null;
    const contentChanged = (params.patch.content && params.patch.content !== m.content) || (params.patch.title && params.patch.title !== m.title);
    let result;
    if (contentChanged && (m.status === 'learned' || m.status === 'pinned')) {
      result = await tx.aIMemory.create({
        data: {
          guildId: m.guildId,
          kind: params.patch.kind ?? m.kind,
          title: params.patch.title ?? m.title,
          content: params.patch.content ?? m.content,
          confidence: 1,
          status: params.patch.status ?? m.status,
          createdBy: params.actorId,
          provenance: `Edited by admin; supersedes ${m.id}`,
          sources: { create: m.sources.map((s) => ({ messageId: s.messageId, channelId: s.channelId, jumpUrl: s.jumpUrl })) },
        },
      });
      await tx.aIMemory.update({ where: { id: m.id }, data: { status: 'superseded', supersededById: result.id } });
    } else {
      result = await tx.aIMemory.update({
        where: { id: m.id },
        data: { ...params.patch, ...(params.patch.status === 'pinned' || params.patch.status === 'learned' ? { confidence: Math.max(m.confidence, params.patch.status === 'pinned' ? 1 : m.confidence) } : {}) },
      });
    }
    await writeAudit(tx, { guildId: params.guildId, actorId: params.actorId, module: 'ai', action: 'memory.edit', targetId: m.id, before: { title: m.title, content: m.content, status: m.status }, after: params.patch });
    return result;
  });
}

// ── Automatic learning ──

export const SAFE_MEMORY_KINDS = ['vocabulary', 'project', 'decision', 'term', 'inside_joke'] as const;

export const extractedMemorySchema = z.object({
  kind: z.enum(SAFE_MEMORY_KINDS),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(1000),
  confidence: z.number().min(0).max(1),
  sourceIds: z.array(z.string().regex(/^\d{17,20}$/)).min(1).max(20),
});

export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;

/**
 * Auto-promotion policy: proposals become `learned` only with high confidence
 * and at least two distinct supporting messages. Inside jokes are never
 * promoted automatically (they're not facts). Everything else stays `proposed`.
 */
export function initialMemoryStatus(m: ExtractedMemory, autoLearn: boolean): 'proposed' | 'learned' {
  if (!autoLearn || m.kind === 'inside_joke') return 'proposed';
  return m.confidence >= 0.8 && new Set(m.sourceIds).size >= 2 ? 'learned' : 'proposed';
}

export function parseExtraction(text: string): ExtractedMemory[] {
  const match = /\[[\s\S]*\]/.exec(text);
  if (!match) return [];
  try {
    const raw = JSON.parse(match[0]) as unknown[];
    return raw.flatMap((r) => {
      const p = extractedMemorySchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  } catch {
    return [];
  }
}
