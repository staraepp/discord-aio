import 'server-only';
import { getEnv, type Env } from '@aio/config';
import { getDb, type Db } from '@aio/db';
import { createLogger } from '@aio/logging';

export function env(): Env {
  return getEnv();
}

export function db(): Db {
  return getDb(env().DATABASE_URL);
}

export const log = createLogger('web');

export function guildId(): string {
  const id = env().GUILD_ID;
  if (!id) throw new Error('GUILD_ID is not configured');
  return id;
}
