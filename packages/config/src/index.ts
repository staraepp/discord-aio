import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Canonical environment contract. Mirrors `.env.example`.
 * Optional integrations parse to `undefined` when blank so every consumer can
 * surface an explicit "Not Configured" state instead of guessing.
 */

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)');
const optionalSnowflake = z.preprocess(blankToUndefined, snowflake.optional());
const bool = z.preprocess(
  (v) => (typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()) : v),
  z.boolean(),
);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TOKEN: optionalString,
  GUILD_ID: optionalSnowflake,
  OWNER_DISCORD_USER_ID: z.preprocess(blankToUndefined, snowflake.default('1080222698443124797')),

  DISCORD_CLIENT_ID: optionalSnowflake,
  DISCORD_CLIENT_SECRET: optionalString,
  DISCORD_REDIRECT_URI: optionalString,
  PUBLIC_BASE_URL: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:3000')),
  AUTH_SECRET: optionalString,

  DATABASE_URL: optionalString,

  MUSIC_BOT_2_TOKEN: optionalString,
  MUSIC_BOT_2_CLIENT_ID: optionalSnowflake,
  MUSIC_BOT_3_TOKEN: optionalString,
  MUSIC_BOT_3_CLIENT_ID: optionalSnowflake,

  LAVALINK_URL: optionalString,
  LAVALINK_PASSWORD: optionalString,
  LAVALINK_SECURE: z.preprocess(blankToUndefined, bool.default(false)),
  // Optional music node on a home connection (see docker/home-node). Preferred when online.
  LAVALINK_HOME_URL: optionalString,
  LAVALINK_HOME_PASSWORD: optionalString,

  SPOTIFY_CLIENT_ID: optionalString,
  SPOTIFY_CLIENT_SECRET: optionalString,
  APPLE_MUSIC_DEVELOPER_TOKEN: optionalString,
  APPLE_MUSIC_TEAM_ID: optionalString,
  APPLE_MUSIC_KEY_ID: optionalString,
  APPLE_MUSIC_PRIVATE_KEY: optionalString,

  TURNSTILE_SITE_KEY: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,

  AI_ENCRYPTION_KEY: optionalString,
  GOOGLE_API_KEY: optionalString,
  AI_DEFAULT_MODEL: z.preprocess(blankToUndefined, z.string().default('gemini-3.5-flash-lite')),
  AI_ESCALATION_MODEL: optionalString,
  /** 0 means the free tier (no paid spending expected). */
  AI_MONTHLY_TARGET_USD: z.preprocess(blankToUndefined, z.coerce.number().min(0).default(10)),

  BOT_HEALTH_PORT: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(8081)),
  LOG_LEVEL: z.preprocess(
    blankToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ),
  /**
   * Which proxy sits in front of the dashboard, so the visitor IP used for rate limits comes from a header
   * that proxy controls. `cloudflare` (Cloudflare Tunnel) trusts CF-Connecting-IP; only use it when the
   * dashboard is NOT reachable any other way, or the header could be forged.
   */
  TRUST_PROXY: z.preprocess(blankToUndefined, z.enum(['none', 'cloudflare']).default('none')),
  /** Development-only dashboard preview login. Ignored when NODE_ENV=production. */
  DASHBOARD_DEV_LOGIN: z.preprocess(blankToUndefined, bool.default(false)),
});

export type Env = z.infer<typeof envSchema>;

/** Values that look like the illustrative placeholders shipped in `.env`. */
const PLACEHOLDER_TOKENS = new Set(['bottoken', 'token', 'changeme', 'your-token-here']);

export function isPlaceholderSecret(value: string | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDER_TOKENS.has(value.trim().toLowerCase()) || value.trim().length < 20;
}

/** A Discord bot token has three base64url segments separated by dots. */
export function looksLikeDiscordToken(value: string | undefined): boolean {
  if (!value || isPlaceholderSecret(value)) return false;
  return /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(value.trim());
}

function findRepoRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

let loaded = false;
/** Loads the repository root `.env` (never overrides variables already injected by the platform). */
export function loadEnvFile(): void {
  if (loaded) return;
  loaded = true;
  const root = findRepoRoot(process.cwd());
  if (root && existsSync(join(root, '.env'))) {
    loadDotenv({ path: join(root, '.env'), override: false, quiet: true });
  }
}

let cached: Env | undefined;

export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && cached) return cached;
  if (source === process.env) loadEnvFile();
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Only report variable NAMES and the validation message, never values.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export type IntegrationState = 'configured' | 'not_configured' | 'invalid';

export interface IntegrationStatus {
  id: string;
  label: string;
  state: IntegrationState;
  detail: string;
  missing: string[];
}

function status(id: string, label: string, required: Record<string, string | undefined>, extra?: () => string | null): IntegrationStatus {
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    return { id, label, state: 'not_configured', detail: `Missing ${missing.join(', ')}`, missing };
  }
  const problem = extra?.();
  if (problem) return { id, label, state: 'invalid', detail: problem, missing: [] };
  return { id, label, state: 'configured', detail: 'Configured (not live-verified)', missing: [] };
}

/**
 * Static configuration status. "configured" only means the variables are present;
 * live connectivity is reported separately by the running services.
 */
export function integrationStatuses(env: Env): IntegrationStatus[] {
  return [
    status('discord-bot', 'Main Discord bot', { TOKEN: env.TOKEN, GUILD_ID: env.GUILD_ID }, () =>
      looksLikeDiscordToken(env.TOKEN) ? null : 'TOKEN is a placeholder or malformed',
    ),
    status('discord-oauth', 'Dashboard Discord OAuth', {
      DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID,
      DISCORD_CLIENT_SECRET: env.DISCORD_CLIENT_SECRET,
      AUTH_SECRET: env.AUTH_SECRET,
    }, () => (env.AUTH_SECRET && env.AUTH_SECRET.length < 32 ? 'AUTH_SECRET must be at least 32 characters' : null)),
    status('database', 'PostgreSQL', { DATABASE_URL: env.DATABASE_URL }),
    status('music-bot-2', 'Music player #2', { MUSIC_BOT_2_TOKEN: env.MUSIC_BOT_2_TOKEN }, () =>
      looksLikeDiscordToken(env.MUSIC_BOT_2_TOKEN) ? null : 'MUSIC_BOT_2_TOKEN looks malformed',
    ),
    status('music-bot-3', 'Music player #3', { MUSIC_BOT_3_TOKEN: env.MUSIC_BOT_3_TOKEN }, () =>
      looksLikeDiscordToken(env.MUSIC_BOT_3_TOKEN) ? null : 'MUSIC_BOT_3_TOKEN looks malformed',
    ),
    status('lavalink', 'Lavalink audio backend', {
      LAVALINK_URL: env.LAVALINK_URL,
      LAVALINK_PASSWORD: env.LAVALINK_PASSWORD,
    }),
    status('lavalink-home', 'Home music node', {
      LAVALINK_HOME_URL: env.LAVALINK_HOME_URL,
      LAVALINK_HOME_PASSWORD: env.LAVALINK_HOME_PASSWORD,
    }),
    status('spotify', 'Spotify metadata', {
      SPOTIFY_CLIENT_ID: env.SPOTIFY_CLIENT_ID,
      SPOTIFY_CLIENT_SECRET: env.SPOTIFY_CLIENT_SECRET,
    }),
    // A MusicKit key (preferred, tokens are signed and refreshed automatically) or a fixed token.
    env.APPLE_MUSIC_DEVELOPER_TOKEN && !env.APPLE_MUSIC_PRIVATE_KEY
      ? status('apple-music', 'Apple Music playlists', { APPLE_MUSIC_DEVELOPER_TOKEN: env.APPLE_MUSIC_DEVELOPER_TOKEN })
      : status('apple-music', 'Apple Music playlists', { APPLE_MUSIC_TEAM_ID: env.APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID: env.APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY: env.APPLE_MUSIC_PRIVATE_KEY }),
    status('turnstile', 'Cloudflare Turnstile', {
      TURNSTILE_SITE_KEY: env.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
    }),
    status('ai-encryption', 'AI key encryption', { AI_ENCRYPTION_KEY: env.AI_ENCRYPTION_KEY }, () => {
      const key = env.AI_ENCRYPTION_KEY ? Buffer.from(env.AI_ENCRYPTION_KEY, 'base64') : Buffer.alloc(0);
      return key.length === 32 ? null : 'AI_ENCRYPTION_KEY must be 32 bytes encoded as base64';
    }),
    status('google-ai', 'Google Gemini bootstrap key', { GOOGLE_API_KEY: env.GOOGLE_API_KEY }),
  ];
}

export interface MusicIdentityConfig {
  slot: 1 | 2 | 3;
  token: string;
  clientId?: string;
  isMain: boolean;
}

/** Main bot is always player #1. Optional identities are only included when a plausible token exists. */
export function musicIdentities(env: Env): MusicIdentityConfig[] {
  const out: MusicIdentityConfig[] = [];
  if (looksLikeDiscordToken(env.TOKEN)) out.push({ slot: 1, token: env.TOKEN!, clientId: env.DISCORD_CLIENT_ID, isMain: true });
  if (looksLikeDiscordToken(env.MUSIC_BOT_2_TOKEN))
    out.push({ slot: 2, token: env.MUSIC_BOT_2_TOKEN!, clientId: env.MUSIC_BOT_2_CLIENT_ID, isMain: false });
  if (looksLikeDiscordToken(env.MUSIC_BOT_3_TOKEN))
    out.push({ slot: 3, token: env.MUSIC_BOT_3_TOKEN!, clientId: env.MUSIC_BOT_3_CLIENT_ID, isMain: false });
  return out;
}

export const OWNER_ID_DEFAULT = '1080222698443124797';
export const AI_TRIGGER_ROLE_ID_DEFAULT = '1551266433604780221';
