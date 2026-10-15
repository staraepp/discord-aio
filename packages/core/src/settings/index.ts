import type { z } from 'zod';
import type { Db, DbOrTx } from '@aio/db';
import type { StaffRoleConfig } from '@aio/permissions';
import { getModule, MODULES, type ModuleId } from '../modules/index';
import { writeAudit } from '../audit/index';
import type {
  aiSettingsSchema,
  giveawaySettingsSchema,
  levelingSettingsSchema,
  pollSettingsSchema,
  reminderSettingsSchema,
  starboardSettingsSchema,
  moderationSettingsSchema,
  musicSettingsSchema,
  tempVcSettingsSchema,
  ticketSettingsSchema,
  verificationSettingsSchema,
  welcomeSettingsSchema,
} from './schemas';

export * from './schemas';

export interface ModuleSettingsMap {
  music: z.infer<typeof musicSettingsSchema>;
  tempvc: z.infer<typeof tempVcSettingsSchema>;
  leveling: z.infer<typeof levelingSettingsSchema>;
  moderation: z.infer<typeof moderationSettingsSchema>;
  tickets: z.infer<typeof ticketSettingsSchema>;
  welcome: z.infer<typeof welcomeSettingsSchema>;
  verification: z.infer<typeof verificationSettingsSchema>;
  ai: z.infer<typeof aiSettingsSchema>;
  embeds: Record<string, unknown>;
  autoresponders: Record<string, unknown>;
  forms: Record<string, unknown>;
  rolepanels: Record<string, unknown>;
  honeypot: Record<string, unknown>;
  giveaways: z.infer<typeof giveawaySettingsSchema>;
  polls: z.infer<typeof pollSettingsSchema>;
  reminders: z.infer<typeof reminderSettingsSchema>;
  starboard: z.infer<typeof starboardSettingsSchema>;
}

export interface ModuleState<K extends ModuleId> {
  enabled: boolean;
  settings: ModuleSettingsMap[K];
  /** True when stored settings failed validation and defaults were used instead. */
  settingsInvalid: boolean;
}

export function parseModuleSettings<K extends ModuleId>(id: K, raw: unknown): { settings: ModuleSettingsMap[K]; invalid: boolean } {
  const def = getModule(id)!;
  const parsed = def.settingsSchema.safeParse(raw ?? {});
  if (parsed.success) return { settings: parsed.data as ModuleSettingsMap[K], invalid: false };
  return { settings: def.settingsSchema.parse({}) as ModuleSettingsMap[K], invalid: true };
}

export async function getModuleState<K extends ModuleId>(db: DbOrTx, guildId: string, id: K): Promise<ModuleState<K>> {
  const row = await db.moduleConfig.findUnique({ where: { guildId_moduleId: { guildId, moduleId: id } } });
  const def = getModule(id)!;
  const { settings, invalid } = parseModuleSettings(id, row?.settings);
  return { enabled: row ? row.enabled : def.defaultEnabled, settings, settingsInvalid: invalid };
}

export async function getEnabledModules(db: DbOrTx, guildId: string): Promise<Set<ModuleId>> {
  const rows = await db.moduleConfig.findMany({ where: { guildId } });
  const byId = new Map(rows.map((r) => [r.moduleId, r.enabled]));
  return new Set(MODULES.filter((m) => byId.get(m.id) ?? m.defaultEnabled).map((m) => m.id));
}

export async function setModuleEnabled(db: Db, guildId: string, id: ModuleId, enabled: boolean, actorId: string): Promise<void> {
  const def = getModule(id)!;
  await db.$transaction(async (tx) => {
    const before = await tx.moduleConfig.findUnique({ where: { guildId_moduleId: { guildId, moduleId: id } } });
    await tx.moduleConfig.upsert({
      where: { guildId_moduleId: { guildId, moduleId: id } },
      create: { guildId, moduleId: id, enabled, settings: {}, updatedBy: actorId },
      update: { enabled, updatedBy: actorId },
    });
    await writeAudit(tx, {
      guildId,
      actorId,
      module: id,
      action: enabled ? 'module.enable' : 'module.disable',
      before: { enabled: before ? before.enabled : def.defaultEnabled },
      after: { enabled },
    });
  });
}

export type SettingsUpdateResult<K extends ModuleId> =
  | { ok: true; settings: ModuleSettingsMap[K] }
  | { ok: false; issues: { path: string; message: string }[] };

export async function updateModuleSettings<K extends ModuleId>(
  db: Db,
  guildId: string,
  id: K,
  input: unknown,
  actorId: string,
): Promise<SettingsUpdateResult<K>> {
  const def = getModule(id)!;
  const parsed = def.settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  await db.$transaction(async (tx) => {
    const before = await tx.moduleConfig.findUnique({ where: { guildId_moduleId: { guildId, moduleId: id } } });
    await tx.moduleConfig.upsert({
      where: { guildId_moduleId: { guildId, moduleId: id } },
      create: { guildId, moduleId: id, enabled: def.defaultEnabled, settings: parsed.data as object, updatedBy: actorId },
      update: { settings: parsed.data as object, updatedBy: actorId },
    });
    await writeAudit(tx, { guildId, actorId, module: id, action: 'settings.update', before: before?.settings ?? null, after: parsed.data });
  });
  return { ok: true, settings: parsed.data as ModuleSettingsMap[K] };
}

export async function getStaffRoles(db: DbOrTx, guildId: string): Promise<StaffRoleConfig> {
  const cfg = await db.guildConfig.findUnique({ where: { id: guildId } });
  return {
    staffRoleIds: cfg?.staffRoleIds ?? [],
    musicStaffRoleIds: cfg?.musicStaffRoleIds ?? [],
    ticketStaffRoleIds: cfg?.ticketStaffRoleIds ?? [],
  };
}

/** Atomic per-guild counter (case numbers, ticket numbers). */
export async function nextCounter(db: DbOrTx, guildId: string, name: string): Promise<number> {
  const row = await db.guildCounter.upsert({
    where: { guildId_name: { guildId, name } },
    create: { guildId, name, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}
