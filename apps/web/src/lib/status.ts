import 'server-only';
import { integrationStatuses } from '@aio/config';
import { db, env } from './server';

export const HEARTBEAT_STALE_MS = 90_000;

/** Live bot status comes only from recent heartbeats; configured env alone never means "connected". */
export async function botStatus() {
  const beats = await db().botHeartbeat.findMany({ orderBy: { id: 'asc' } });
  const now = Date.now();
  return beats.map((b) => ({
    id: b.id,
    online: b.online && now - b.updatedAt.getTime() < HEARTBEAT_STALE_MS,
    botTag: b.botTag,
    latencyMs: b.latencyMs,
    lastSeen: b.updatedAt.toISOString(),
    details: b.details,
  }));
}

export function integrations() {
  return integrationStatuses(env()).map(({ id, label, state, detail, missing }) => ({ id, label, state, detail, missing }));
}
