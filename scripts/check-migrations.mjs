#!/usr/bin/env node
/**
 * Clean-database migration check.
 *
 * 1. Creates a brand-new, run-owned database next to TEST_DATABASE_URL (or DATABASE_URL).
 * 2. Applies every migration from scratch with `prisma migrate deploy`.
 * 3. Verifies the migrated schema has no drift from prisma/schema.prisma.
 * 4. Verifies the AI full-text-search trigger populates the tsvector column.
 * 5. Drops ONLY the database it created. Existing databases are never touched.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';
import pg from 'pg';

if (existsSync('.env')) config({ path: '.env', quiet: true });
const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!base) {
  console.error('Set TEST_DATABASE_URL (or DATABASE_URL) to a PostgreSQL server where a temporary database can be created.');
  process.exit(1);
}

const name = `aio_migcheck_${Date.now()}_${randomBytes(3).toString('hex')}`;
const url = new URL(base);
url.pathname = `/${name}`;
const env = { ...process.env, DATABASE_URL: url.toString(), PRISMA_HIDE_UPDATE_MESSAGE: '1' };
const prisma = (args) => execFileSync('pnpm', ['exec', 'prisma', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();

let failed = false;
try {
  process.stdout.write(`• Applying migrations to fresh database ${name}… `);
  prisma(['migrate', 'deploy']);
  console.log('ok');

  process.stdout.write('• Checking for drift between migrations and schema.prisma… ');
  try {
    prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
    console.log('ok (no drift)');
  } catch (err) {
    if (err.status === 2) {
      console.log('DRIFT FOUND');
      console.log(prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script']));
      failed = true;
    } else throw err;
  }

  process.stdout.write('• Checking the AI full-text search trigger… ');
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  await c.query(
    `INSERT INTO "AIIndexedMessage" (id, "guildId", "channelId", "authorId", "authorName", content, "jumpUrl", "createdAt") VALUES ('1', '1', '1', '1', 'Ada', 'release schedule friday', 'https://discord.com', now())`,
  );
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM "AIIndexedMessage" WHERE search @@ to_tsquery('simple', 'schedule')`);
  await c.end();
  if (rows[0].n !== 1) {
    console.log('FAILED');
    failed = true;
  } else console.log('ok');
} catch (err) {
  failed = true;
  console.error('\nMigration check failed:', err.stderr?.toString() || err.message);
} finally {
  const d = new pg.Client({ connectionString: base });
  await d.connect();
  await d.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await d.end();
}

console.log(failed ? '\n✗ Migration check failed.' : '\n✓ Migrations apply cleanly to an empty database and match the schema.');
process.exit(failed ? 1 : 0);
