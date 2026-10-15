import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';

export type Db = PrismaClient;
/** Interactive-transaction client type. */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;
export type DbOrTx = Db | Tx;

export function createDb(connectionString: string): Db {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as unknown as { __aioDb?: Db };

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  if (!globalForDb.__aioDb) globalForDb.__aioDb = createDb(connectionString);
  return globalForDb.__aioDb;
}

export async function checkDbHealth(db: Db): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: err instanceof Error ? err.name : 'DatabaseError' };
  }
}

export const DASHBOARD_COMMAND_CHANNEL = 'aio_dashboard_command';

/** Notify the bot that a DashboardCommand row is pending. Polling is the fallback. */
export async function notifyDashboardCommand(db: Db, id: string): Promise<void> {
  await db.$executeRaw`SELECT pg_notify(${DASHBOARD_COMMAND_CHANNEL}, ${id})`;
}

/** Dedicated LISTEN connection (Prisma pools cannot hold LISTEN state). */
export async function listen(
  connectionString: string,
  channel: string,
  onMessage: (payload: string) => void,
  onError: (err: Error) => void,
): Promise<() => Promise<void>> {
  if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error('Invalid channel name');
  const client = new pg.Client({ connectionString });
  client.on('notification', (msg) => {
    if (msg.channel === channel) onMessage(msg.payload ?? '');
  });
  client.on('error', onError);
  await client.connect();
  await client.query(`LISTEN ${channel}`);
  return async () => {
    await client.end().catch(() => undefined);
  };
}
