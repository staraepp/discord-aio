import type { Db, MusicQueueEntry, MusicSession, Tx } from '@aio/db';
import { nextPosition, planEnqueue, previousPosition, shuffleEntries, type AdvanceReason, type EnqueuePlan, type LoopMode, type Timeline } from './queue';

/**
 * PostgreSQL persistence for music sessions. Every queue mutation runs in a
 * transaction holding a row lock on the session, so concurrent enqueues cannot
 * race past the five-in-a-row rule and cursor moves are serialised.
 */

export type SessionWithEntries = MusicSession & { entries: MusicQueueEntry[] };

export interface NewTrack {
  title: string;
  author: string;
  durationMs: number | null;
  uri: string | null;
  sourceName: string;
  /** Encoded backend track; empty string means "metadata only, resolve lazily before playing". */
  encoded: string;
  artworkUrl: string | null;
  isStream: boolean;
  isSeekable: boolean;
  isrc?: string | null;
  resolvedFrom?: string | null;
  originalUri?: string | null;
  substitutionNote?: string | null;
}

/** How many played entries to retain in the timeline for /previous (unless looping the queue). */
export const HISTORY_RETENTION = 50;

async function lockSession(tx: Tx, sessionId: string): Promise<MusicSession> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "MusicSession" WHERE id = ${sessionId} FOR UPDATE`;
  if (rows.length === 0) throw new Error('Music session not found');
  return tx.musicSession.findUniqueOrThrow({ where: { id: sessionId } });
}

export function toTimeline(session: MusicSession, entries: MusicQueueEntry[]): Timeline<MusicQueueEntry> {
  return { entries: [...entries].sort((a, b) => a.position - b.position), cursor: session.cursor };
}

export async function loadSession(db: Db | Tx, sessionId: string): Promise<SessionWithEntries | null> {
  return db.musicSession.findUnique({ where: { id: sessionId }, include: { entries: { orderBy: { position: 'asc' } } } });
}

export async function findSessionByVoice(db: Db | Tx, guildId: string, voiceChannelId: string): Promise<SessionWithEntries | null> {
  return db.musicSession.findUnique({
    where: { guildId_voiceChannelId: { guildId, voiceChannelId } },
    include: { entries: { orderBy: { position: 'asc' } } },
  });
}

export async function getOrCreateSession(
  db: Db,
  params: { guildId: string; voiceChannelId: string; textChannelId?: string | null; kind: 'public' | 'temp'; volume: number },
): Promise<MusicSession> {
  return db.musicSession.upsert({
    where: { guildId_voiceChannelId: { guildId: params.guildId, voiceChannelId: params.voiceChannelId } },
    create: {
      guildId: params.guildId,
      voiceChannelId: params.voiceChannelId,
      textChannelId: params.textChannelId ?? null,
      kind: params.kind,
      volume: params.volume,
    },
    update: params.textChannelId ? { textChannelId: params.textChannelId } : {},
  });
}

/** Rewrites pending positions to cursor+1..cursor+n in the given order (two-phase to respect the unique index). */
async function writePendingOrder(tx: Tx, session: MusicSession, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await tx.$executeRaw`UPDATE "MusicQueueEntry" SET position = -position - 1000000 WHERE "sessionId" = ${session.id} AND id = ANY(${orderedIds})`;
  for (let i = 0; i < orderedIds.length; i++) {
    await tx.musicQueueEntry.update({ where: { id: orderedIds[i]! }, data: { position: session.cursor + 1 + i } });
  }
  const max = await tx.musicQueueEntry.aggregate({ where: { sessionId: session.id }, _max: { position: true } });
  await tx.musicSession.update({ where: { id: session.id }, data: { nextPosition: Math.max(session.cursor + 1, (max._max.position ?? -1) + 1) } });
}

export interface EnqueueResult extends EnqueuePlan {
  entries: MusicQueueEntry[];
}

export async function enqueueTracks(
  db: Db,
  params: { sessionId: string; requesterId: string; tracks: NewTrack[]; bypass: boolean; limit: number; staffAdded: boolean; playNext?: boolean },
): Promise<EnqueueResult> {
  return db.$transaction(async (tx) => {
    const session = await lockSession(tx, params.sessionId);
    const pending = await tx.musicQueueEntry.findMany({
      where: { sessionId: session.id, position: { gt: session.cursor } },
      orderBy: { position: 'asc' },
      select: { id: true, requesterId: true },
    });
    const plan = planEnqueue({ pending, requesterId: params.requesterId, count: params.tracks.length, limit: params.limit, bypass: params.bypass });
    const accepted = params.tracks.slice(0, plan.accepted);
    const created: MusicQueueEntry[] = [];
    let pos = Math.max(session.nextPosition, session.cursor + 1);
    for (const t of accepted) {
      created.push(
        await tx.musicQueueEntry.create({
          data: {
            sessionId: session.id,
            position: pos++,
            requesterId: params.requesterId,
            staffAdded: params.staffAdded,
            title: t.title.slice(0, 500),
            author: t.author.slice(0, 300),
            durationMs: t.durationMs,
            uri: t.uri,
            sourceName: t.sourceName,
            encoded: t.encoded,
            artworkUrl: t.artworkUrl,
            isStream: t.isStream,
            isSeekable: t.isSeekable,
            isrc: t.isrc ?? null,
            resolvedFrom: t.resolvedFrom ?? null,
            originalUri: t.originalUri ?? null,
            substitutionNote: t.substitutionNote ?? null,
          },
        }),
      );
    }
    await tx.musicSession.update({ where: { id: session.id }, data: { nextPosition: pos, lastActiveAt: new Date() } });
    if (params.playNext && created.length > 0) {
      const newIds = created.map((c) => c.id);
      await writePendingOrder(tx, { ...session, nextPosition: pos }, [...newIds, ...pending.map((p) => p.id)]);
    }
    return { ...plan, entries: created };
  });
}

export interface CursorMove {
  entry: MusicQueueEntry | null;
  session: MusicSession;
}

/** Advance after a track ends or is skipped. Returns the new current entry, or null when the queue is finished. */
export async function advance(db: Db, sessionId: string, reason: AdvanceReason): Promise<CursorMove> {
  return db.$transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const entries = await tx.musicQueueEntry.findMany({ where: { sessionId }, orderBy: { position: 'asc' } });
    const timeline = toTimeline(session, entries);
    const next = nextPosition(timeline, session.loopMode as LoopMode, reason);
    if (next === null) {
      // End of queue: keep the finished track as history, playback stops (no autoplay).
      const lastPos = entries.length ? entries[entries.length - 1]!.position : session.cursor;
      const updated = await tx.musicSession.update({
        where: { id: sessionId },
        data: { cursor: Math.max(session.cursor, lastPos), state: 'idle', positionMs: 0, positionUpdatedAt: new Date() },
      });
      return { entry: null, session: updated };
    }
    const updated = await tx.musicSession.update({
      where: { id: sessionId },
      data: { cursor: next, state: 'playing', positionMs: 0, positionUpdatedAt: new Date(), lastActiveAt: new Date() },
    });
    if (session.loopMode !== 'queue') await pruneHistory(tx, updated);
    return { entry: entries.find((e) => e.position === next) ?? null, session: updated };
  });
}

/** Idle session with pending tracks: start the first pending one. */
export async function startIfIdle(db: Db, sessionId: string): Promise<CursorMove | null> {
  return db.$transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const entries = await tx.musicQueueEntry.findMany({ where: { sessionId }, orderBy: { position: 'asc' } });
    if (session.state === 'playing' || session.state === 'paused') return null;
    const first = entries.find((e) => e.position > session.cursor);
    if (!first) return null;
    const updated = await tx.musicSession.update({
      where: { id: sessionId },
      data: { cursor: first.position, state: 'playing', positionMs: 0, positionUpdatedAt: new Date(), lastActiveAt: new Date() },
    });
    return { entry: first, session: updated };
  });
}

export async function goPrevious(db: Db, sessionId: string): Promise<CursorMove | null> {
  return db.$transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const entries = await tx.musicQueueEntry.findMany({ where: { sessionId }, orderBy: { position: 'asc' } });
    // After the queue finished (idle), "previous" replays the track that just ended.
    const finished = session.state === 'idle' ? entries.find((e) => e.position === session.cursor) : undefined;
    const prev = finished ? finished.position : previousPosition(toTimeline(session, entries));
    if (prev === null) return null;
    const updated = await tx.musicSession.update({
      where: { id: sessionId },
      data: { cursor: prev, state: 'playing', positionMs: 0, positionUpdatedAt: new Date(), lastActiveAt: new Date() },
    });
    return { entry: entries.find((e) => e.position === prev) ?? null, session: updated };
  });
}

async function pruneHistory(tx: Tx, session: MusicSession): Promise<void> {
  const history = await tx.musicQueueEntry.findMany({
    where: { sessionId: session.id, position: { lt: session.cursor } },
    orderBy: { position: 'desc' },
    select: { id: true },
    skip: HISTORY_RETENTION,
  });
  if (history.length) await tx.musicQueueEntry.deleteMany({ where: { id: { in: history.map((h) => h.id) } } });
}

export async function pendingOf(db: Db | Tx, session: MusicSession): Promise<MusicQueueEntry[]> {
  return db.musicQueueEntry.findMany({ where: { sessionId: session.id, position: { gt: session.cursor } }, orderBy: { position: 'asc' } });
}

export async function removePending(db: Db, sessionId: string, entryIds: string[]): Promise<number> {
  return db.$transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const res = await tx.musicQueueEntry.deleteMany({ where: { sessionId, id: { in: entryIds }, position: { gt: session.cursor } } });
    return res.count;
  });
}

export async function clearPending(db: Db, sessionId: string, requesterId?: string): Promise<number> {
  return db.$transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const res = await tx.musicQueueEntry.deleteMany({
      where: { sessionId, position: { gt: session.cursor }, ...(requesterId ? { requesterId } : {}) },
    });
    return res.count;
  });
}

/** Reorder pending entries to exactly `orderedIds` (must be a permutation of the pending IDs). */
export async function reorderPending(db: Db, sessionId: string, orderedIds: string[]): Promise<void> {
  await db.$transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const pending = await pendingOf(tx, session);
    const ids = new Set(pending.map((p) => p.id));
    if (orderedIds.length !== ids.size || !orderedIds.every((id) => ids.has(id))) {
      throw new Error('Queue changed while you were editing it. Refresh and try again.');
    }
    await writePendingOrder(tx, session, orderedIds);
  });
}

export async function shufflePending(db: Db, sessionId: string, random: () => number = Math.random): Promise<number> {
  return db.$transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const pending = await pendingOf(tx, session);
    if (pending.length < 2) return pending.length;
    await writePendingOrder(tx, session, shuffleEntries(pending, random).map((p) => p.id));
    return pending.length;
  });
}

/** Staff jump: bring the target pending entry to the front so the next advance plays it. Other tracks stay queued. */
export async function bringToFront(db: Db, sessionId: string, entryId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const session = await lockSession(tx, sessionId);
    const pending = await pendingOf(tx, session);
    const target = pending.find((p) => p.id === entryId);
    if (!target) return false;
    await writePendingOrder(tx, session, [target.id, ...pending.filter((p) => p.id !== entryId).map((p) => p.id)]);
    return true;
  });
}

export async function updateSession(db: Db | Tx, sessionId: string, data: Partial<Pick<MusicSession, 'state' | 'volume' | 'loopMode' | 'is247' | 'identitySlot' | 'positionMs' | 'textChannelId'>> & { filters?: object | null }): Promise<MusicSession> {
  const { filters, ...rest } = data;
  return db.musicSession.update({
    where: { id: sessionId },
    data: {
      ...rest,
      ...(filters !== undefined ? { filters: filters ?? undefined } : {}),
      ...(data.positionMs !== undefined ? { positionUpdatedAt: new Date() } : {}),
      lastActiveAt: new Date(),
    },
  });
}

export async function setEntryPlayable(db: Db | Tx, entryId: string, data: Pick<MusicQueueEntry, 'encoded' | 'uri' | 'sourceName' | 'durationMs' | 'isSeekable' | 'isStream' | 'substitutionNote'> & { artworkUrl?: string | null }): Promise<MusicQueueEntry> {
  return db.musicQueueEntry.update({ where: { id: entryId }, data });
}

export async function recordHistory(db: Db | Tx, session: MusicSession, entry: MusicQueueEntry): Promise<void> {
  await db.musicHistory.create({
    data: {
      guildId: session.guildId,
      voiceChannelId: session.voiceChannelId,
      sessionKind: session.kind,
      requesterId: entry.requesterId,
      title: entry.title,
      author: entry.author,
      uri: entry.uri,
      sourceName: entry.sourceName,
      durationMs: entry.durationMs,
    },
  });
}

export async function deleteSession(db: Db | Tx, sessionId: string): Promise<void> {
  await db.musicSession.deleteMany({ where: { id: sessionId } });
}
