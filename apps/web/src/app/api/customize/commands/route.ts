import { commandSettingsSchema, getCommandSettings } from '@aio/core/customize';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

interface CatalogEntry {
  module: string;
  data: { name: string; description?: string; default_member_permissions?: string | null; options?: unknown[] };
}

/** Command definitions published by the bot at its last command sync. */
async function catalog(): Promise<CatalogEntry[]> {
  const hb = await db().botHeartbeat.findUnique({ where: { id: 'main' } });
  const details = (hb?.details ?? {}) as { catalog?: CatalogEntry[] };
  return details.catalog ?? [];
}

export const GET = adminRoute(async ({ guildId }) => {
  return { settings: await getCommandSettings(db(), guildId), catalog: await catalog() };
});

export const PUT = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, commandSettingsSchema);
  const names = new Set((await catalog()).map((c) => c.data.name));
  for (const [name, rule] of Object.entries(input.commands)) {
    for (const alias of rule.aliases) if (names.has(alias)) throw new HttpError(400, `"${alias}" is already a command name, so it can't be an alias of ${name}.`);
  }
  const before = await getCommandSettings(db(), guildId);
  await db().guildConfig.upsert({ where: { id: guildId }, create: { id: guildId, commandSettings: input as object }, update: { commandSettings: input as object } });
  await audit(session, { module: 'core', action: 'commands.update', before, after: input });
  await command(session, 'settings.changed');
  // Turning a command on/off changes what Discord shows in the slash menu.
  await command(session, 'commands.sync');
  return input;
});
