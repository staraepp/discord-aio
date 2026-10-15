import type { AIChannelConfig, AIMemory, Db } from '@aio/db';

/**
 * Permission-safe retrieval. A source is only eligible if:
 *  - its channel is allowlisted, searchable, and (if private) explicitly confirmed;
 *  - the requester can currently view that channel; and
 *  - everyone who can read the AI output channel can also view it (so public
 *    answers never leak hidden-channel content).
 * Deleted/inaccessible messages are removed from the index, so they never match.
 */

export interface VisibilityPort {
  memberCanView(userId: string, channelId: string): boolean;
  /** True if every member able to read `outputChannelId` can also read `sourceChannelId`. */
  audienceCanView(sourceChannelId: string, outputChannelId: string): boolean;
}

export function eligibleChannels(configs: AIChannelConfig[], requesterId: string, outputChannelId: string, vis: VisibilityPort): string[] {
  return configs
    .filter((c) => c.searchable && (!c.isPrivate || c.privateConfirmedAt))
    .filter((c) => vis.memberCanView(requesterId, c.channelId) && vis.audienceCanView(c.channelId, outputChannelId))
    .map((c) => c.channelId);
}

const STOPWORDS = new Set(
  'the a an and or but is are was were be been to of in on at for with what who whom whose which when where why how do does did can could should would will i you he she it we they me my your our their this that these those there here about from as by not no yes if then than so just any some please help apple bot'.split(' '),
);

/** Sanitised OR-query terms for to_tsquery (letters/numbers only, prefix match). */
export function queryTerms(question: string, max = 12): string[] {
  const words = question
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, max);
}

export interface RetrievedSource {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  content: string;
  jumpUrl: string;
  createdAt: Date;
  rank: number;
}

export async function searchMessages(db: Db, params: { guildId: string; question: string; channelIds: string[]; limit: number }): Promise<RetrievedSource[]> {
  const terms = queryTerms(params.question);
  if (terms.length === 0 || params.channelIds.length === 0) return [];
  const tsquery = terms.map((t) => `${t}:*`).join(' | ');
  return db.$queryRaw<RetrievedSource[]>`
    SELECT m.id, m."channelId", m."authorId", m."authorName", m.content, m."jumpUrl", m."createdAt",
           ts_rank(m.search, to_tsquery('simple', ${tsquery})) * (1 + COALESCE(c."citationPriority", 0) * 0.1) AS rank
    FROM "AIIndexedMessage" m
    JOIN "AIChannelConfig" c ON c."guildId" = m."guildId" AND c."channelId" = m."channelId"
    WHERE m."guildId" = ${params.guildId}
      AND m."channelId" = ANY(${params.channelIds})
      AND c.searchable = true
      AND m.search @@ to_tsquery('simple', ${tsquery})
    ORDER BY rank DESC, m."createdAt" DESC
    LIMIT ${params.limit}`;
}

export type MemoryWithSources = AIMemory & { sources: { channelId: string; jumpUrl: string; messageId: string }[] };

/**
 * Memories usable for this requester: pinned or learned, and every source
 * channel must be eligible. Admin-created memories without sources are usable.
 * Pinned facts take precedence (listed first).
 */
export function usableMemories(memories: MemoryWithSources[], eligible: Set<string>): MemoryWithSources[] {
  return memories
    .filter((m) => m.status === 'pinned' || m.status === 'learned')
    .filter((m) => m.sources.every((s) => eligible.has(s.channelId)))
    .sort((a, b) => (a.status === b.status ? b.confidence - a.confidence : a.status === 'pinned' ? -1 : 1));
}

export function scoreByTerms(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
}
