import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string | null;
  }
}

/**
 * Integration tests run against a real PostgreSQL server when TEST_DATABASE_URL
 * is set. Each run creates its OWN throwaway database, applies every migration
 * from scratch with `prisma migrate deploy` (proving clean-DB migrations), and
 * drops only that run-owned database afterwards. Existing databases are never
 * reset. Without TEST_DATABASE_URL, DB suites are reported as skipped.
 */
export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    console.warn('\n[tests] TEST_DATABASE_URL not set — database integration suites will be SKIPPED.\n');
    project.provide('testDatabaseUrl', null);
    return;
  }
  const name = `aio_test_run_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(base);
  url.pathname = `/${name}`;
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url.toString(), PRISMA_HIDE_UPDATE_MESSAGE: '1' } });
  project.provide('testDatabaseUrl', url.toString());

  return async () => {
    const c = new pg.Client({ connectionString: base });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.end();
  };
}
