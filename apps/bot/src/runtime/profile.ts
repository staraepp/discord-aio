import { Routes } from 'discord.js';
import type { BotContext } from './context.js';

/**
 * The bot's look in this server only (Discord's "Modify Current Member"): nickname from the
 * saved profile, plus optional one-off avatar/banner/bio changes sent by the dashboard.
 * `null` resets a field to the bot's global profile; `undefined` leaves it alone.
 */
export interface ProfileChanges {
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
}

const IMAGE_DATA_URI = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export async function applyBotProfile(ctx: BotContext, changes: ProfileChanges): Promise<{ ok: true }> {
  const guild = ctx.requireGuild();
  const profile = await ctx.profile();
  const body: Record<string, string | null> = {};
  const me = guild.members.me;
  const wantedNick = profile.nickname || null;
  if (me && (me.nickname ?? null) !== wantedNick) body.nick = wantedNick;
  for (const key of ['avatar', 'banner'] as const) {
    const v = changes[key];
    if (v === undefined) continue;
    if (v !== null && !IMAGE_DATA_URI.test(v)) throw new Error(`The ${key} must be a PNG, JPEG, GIF or WebP image.`);
    body[key] = v;
  }
  if (changes.bio !== undefined) body.bio = changes.bio ? changes.bio.slice(0, 190) : null;
  if (Object.keys(body).length === 0) return { ok: true };
  await ctx.client.rest.patch(Routes.guildMember(guild.id, '@me'), { body, reason: 'Updated from the dashboard' });
  return { ok: true };
}
