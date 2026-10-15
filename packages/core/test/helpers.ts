import { inject } from 'vitest';
import { createDb, type Db } from '@aio/db';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string | null;
  }
}

export const TEST_DB_URL = inject('testDatabaseUrl');
export const hasDb = Boolean(TEST_DB_URL);

let db: Db | undefined;
export function testDb(): Db {
  if (!TEST_DB_URL) throw new Error('TEST_DATABASE_URL not set');
  db ??= createDb(TEST_DB_URL);
  return db;
}

/** Truncate every application table in the run-owned test database. */
export async function resetDb(): Promise<void> {
  const d = testDb();
  const tables = await d.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await d.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export const GUILD = '100000000000000001';
export const snow = (n: number): string => String(200000000000000000n + BigInt(n));
