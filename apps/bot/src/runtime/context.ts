import type { Client, Guild, GuildMember } from 'discord.js';
import type { Env } from '@aio/config';
import type { Db } from '@aio/db';
import type { Logger } from '@aio/logging';
import { newErrorId, serializeError, redactString } from '@aio/logging';
import { getModuleState, getStaffRoles, writeAudit, type AuditEntry, type ModuleId, type ModuleState } from '@aio/core';
import { getBotProfile, getCommandSettings, renderReply, type BotProfile, type CommandSettings, type ReplyKey } from '@aio/core/customize';
import { isMusicStaff, isStaff, isTicketStaff, isAdmin, type StaffRoleConfig } from '@aio/permissions';
import { actorFromMember } from './discord.js';
import type { MusicRuntime } from '../modules/music/runtime.js';

/**
 * Shared runtime context passed to every module. Settings are cached briefly
 * and invalidated when the dashboard reports a change.
 */
export class BotContext {
  private settingsCache = new Map<string, { at: number; value: unknown }>();
  private staffCache: { at: number; value: StaffRoleConfig } | null = null;
  readonly startedAt = new Date();
  music?: MusicRuntime;

  constructor(
    readonly env: Env,
    readonly log: Logger,
    readonly db: Db,
    readonly client: Client,
    readonly guildId: string,
  ) {}

  guild(): Guild | undefined {
    return this.client.guilds.cache.get(this.guildId);
  }

  requireGuild(): Guild {
    const g = this.guild();
    if (!g) throw new Error('Configured guild is not available to the bot (is it invited and is GUILD_ID correct?)');
    return g;
  }

  async module<K extends ModuleId>(id: K): Promise<ModuleState<K>> {
    const hit = this.settingsCache.get(id);
    if (hit && Date.now() - hit.at < 5_000) return hit.value as ModuleState<K>;
    const value = await getModuleState(this.db, this.guildId, id);
    this.settingsCache.set(id, { at: Date.now(), value });
    return value;
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.settingsCache.get(key);
    if (hit && Date.now() - hit.at < 5_000) return hit.value as T;
    const value = await load();
    this.settingsCache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Prefix and per-command rules from the dashboard. */
  commandSettings(): Promise<CommandSettings> {
    return this.cached('@commands', () => getCommandSettings(this.db, this.guildId));
  }

  /** Reply color, nickname, statuses and reworded replies from the dashboard. */
  profile(): Promise<BotProfile> {
    return this.cached('@profile', () => getBotProfile(this.db, this.guildId));
  }

  /** A standard reply, using the admin's wording when they changed it. */
  async reply(key: ReplyKey, vars: Record<string, string | number> = {}): Promise<string> {
    return renderReply(await this.profile().catch(() => null), key, vars);
  }

  /** The dashboard's reply color, or the given default. */
  async replyColor(fallback: number): Promise<number> {
    return (await this.profile().catch(() => null))?.replyColor ?? fallback;
  }

  invalidateSettings(): void {
    this.settingsCache.clear();
    this.staffCache = null;
  }

  async staffRoles(): Promise<StaffRoleConfig> {
    if (this.staffCache && Date.now() - this.staffCache.at < 5_000) return this.staffCache.value;
    const value = await getStaffRoles(this.db, this.guildId);
    this.staffCache = { at: Date.now(), value };
    return value;
  }

  async isStaff(member: GuildMember): Promise<boolean> {
    return isStaff(actorFromMember(member), await this.staffRoles());
  }

  async isMusicStaff(member: GuildMember): Promise<boolean> {
    return isMusicStaff(actorFromMember(member), await this.staffRoles());
  }

  async isTicketStaff(member: GuildMember): Promise<boolean> {
    return isTicketStaff(actorFromMember(member), await this.staffRoles());
  }

  isAdmin(member: GuildMember): boolean {
    return isAdmin(actorFromMember(member));
  }

  isOwner(userId: string): boolean {
    return userId === this.env.OWNER_DISCORD_USER_ID;
  }

  async audit(entry: Omit<AuditEntry, 'guildId'>): Promise<void> {
    await writeAudit(this.db, { ...entry, guildId: this.guildId }).catch((err) => this.log.warn({ err }, 'audit write failed'));
  }

  /** Log an error with a shareable error ID and persist a redacted copy for owner diagnostics. */
  reportError(err: unknown, source: string, context?: Record<string, unknown>): string {
    const errorId = newErrorId();
    this.log.error({ err, errorId, source, ...context }, 'handled error');
    const e = serializeError(err);
    void this.db.appErrorLog
      .create({ data: { errorId, source, message: redactString(`${e.name}: ${e.message}`).slice(0, 2000), context: context ? (JSON.parse(redactString(JSON.stringify(context))) as object) : undefined } })
      .catch(() => undefined);
    return errorId;
  }
}
