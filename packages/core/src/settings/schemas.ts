import { z } from 'zod';
import { messageTemplateSchema } from '@aio/discord-ui';
import { AI_TRIGGER_ROLE_ID_DEFAULT } from '@aio/config';

/** Per-module settings stored in ModuleConfig.settings. Every field has a safe default. */

const snowflake = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID');
const optSnowflake = snowflake.optional().nullable().transform((v) => v ?? undefined);
const snowflakes = z.array(snowflake).max(100).default([]);

export const musicSettingsSchema = z.object({
  musicTextChannelId: optSnowflake,
  historyLogChannelId: optSnowflake,
  panelIntervalSec: z.number().int().min(5).max(15).default(10),
  consecutiveLimit: z.number().int().min(1).max(50).default(5),
  playlistImportCap: z.number().int().min(1).max(500).default(500),
  defaultVolume: z.number().int().min(0).max(200).multipleOf(10).default(100),
  allow247: z.boolean().default(false),
  ephemeralAcks: z.boolean().default(true),
  sources: z
    .object({ youtube: z.boolean().default(true), spotify: z.boolean().default(true), appleMusic: z.boolean().default(true) })
    .default({ youtube: true, spotify: true, appleMusic: true }),
  lyrics: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(['lrclib']).default('lrclib'),
      /** Admin confirms they reviewed the lyrics provider's terms for their use. */
      termsAcknowledged: z.boolean().default(false),
    })
    .default({ enabled: false, provider: 'lrclib', termsAcknowledged: false }),
  panel: z
    .object({
      color: z.number().int().min(0).max(0xffffff).default(0xff7ab6),
      showArtwork: z.boolean().default(true),
      timelineHead: z.string().max(16).default('●'),
      timelineFilled: z.string().max(4).default('━'),
      timelineEmpty: z.string().max(4).default('┄'),
      footerText: z.string().max(200).default('Requested with love'),
    })
    .default({ color: 0x5865f2, showArtwork: true, timelineHead: '●', timelineFilled: '━', timelineEmpty: '┄', footerText: '' }),
});

export const tempVcSettingsSchema = z.object({
  panelChannelId: optSnowflake,
  categoryIds: snowflakes,
  defaultNameTemplate: z.string().min(1).max(100).default("{user.display_name}'s room"),
  defaultUserLimit: z.number().int().min(0).max(99).default(0),
  graceSeconds: z.number().int().min(10).max(300).default(30),
  panelEmbedId: z.string().max(40).optional(),
});

export const levelingPresetSchema = z.enum(['casual', 'active', 'competitive', 'custom']);

const multiplierEntry = z.object({ id: snowflake, multiplier: z.number().min(1).max(10) });

export const levelingSettingsSchema = z.object({
  preset: levelingPresetSchema.default('casual'),
  textXp: z.boolean().default(true),
  voiceXp: z.boolean().default(false),
  cooldownSeconds: z.number().int().min(0).max(3600).default(60),
  xpMin: z.number().int().min(1).max(1000).default(15),
  xpMax: z.number().int().min(1).max(1000).default(25),
  voiceXpPerMinute: z.number().int().min(0).max(100).default(3),
  formula: z.enum(['linear', 'quadratic', 'exponential']).default('quadratic'),
  difficulty: z.number().min(0.25).max(5).default(1),
  ignoredChannelIds: snowflakes,
  ignoredRoleIds: snowflakes,
  bonusChannels: z.array(multiplierEntry).max(50).default([]),
  bonusRoles: z.array(multiplierEntry).max(50).default([]),
  levelUpNotify: z.boolean().default(true),
  levelUpChannelId: optSnowflake,
  levelUpMessage: z.string().max(2000).default('{user} just hit level **{level}** 🥹'),
  levelUpEmbedId: z.string().max(40).optional(),
  rankEnabled: z.boolean().default(true),
  leaderboardEnabled: z.boolean().default(true),
  allowOptOut: z.boolean().default(true),
  staffMode: z.enum(['normal', 'no_xp', 'bonus']).default('normal'),
  staffMultiplier: z.number().min(1).max(5).default(1.5),
  stackRewards: z.boolean().default(true),
});

export const moderationSettingsSchema = z.object({
  modLogChannelId: optSnowflake,
  dmOnAction: z.boolean().default(true),
  automod: z
    .object({
      enabled: z.boolean().default(false),
      alertChannelId: optSnowflake,
      exemptRoleIds: snowflakes,
      keywords: z.array(z.string().min(1).max(100)).max(500).default([]),
      spam: z
        .object({ enabled: z.boolean().default(false), maxMessages: z.number().int().min(3).max(30).default(6), perSeconds: z.number().int().min(2).max(60).default(5) })
        .default({ enabled: false, maxMessages: 6, perSeconds: 5 }),
      mentions: z.object({ enabled: z.boolean().default(false), max: z.number().int().min(2).max(50).default(6) }).default({ enabled: false, max: 6 }),
      repeated: z
        .object({ enabled: z.boolean().default(false), count: z.number().int().min(2).max(20).default(3), withinSeconds: z.number().int().min(5).max(600).default(60) })
        .default({ enabled: false, count: 3, withinSeconds: 60 }),
    })
    .default({
      enabled: false,
      alertChannelId: undefined,
      exemptRoleIds: [],
      keywords: [],
      spam: { enabled: false, maxMessages: 6, perSeconds: 5 },
      mentions: { enabled: false, max: 6 },
      repeated: { enabled: false, count: 3, withinSeconds: 60 },
    }),
});

export const ticketSettingsSchema = z.object({
  logChannelId: optSnowflake,
  transcriptChannelId: optSnowflake,
  maxOpenPerUser: z.number().int().min(1).max(10).default(1),
});

export const welcomeSettingsSchema = z.object({
  welcomeEnabled: z.boolean().default(false),
  welcomeChannelId: optSnowflake,
  welcomeEmbedId: z.string().max(40).optional(),
  welcomeContent: z.string().max(2000).default('Welcome {user}!'),
  goodbyeEnabled: z.boolean().default(false),
  goodbyeChannelId: optSnowflake,
  goodbyeEmbedId: z.string().max(40).optional(),
  goodbyeContent: z.string().max(2000).default('Goodbye {user.name}.'),
});

export const verificationSettingsSchema = z.object({
  unverifiedRoleId: optSnowflake,
  verifiedRoleId: optSnowflake,
  verificationChannelId: optSnowflake,
  allowlistChannelIds: snowflakes,
  panelEmbedId: z.string().max(40).optional(),
  panelTemplate: messageTemplateSchema.optional(),
  logChannelId: optSnowflake,
  staffAlertRoleId: optSnowflake,
  captchaProvider: z.enum(['image', 'builtin', 'turnstile']).default('image'),
  tokenTtlMinutes: z.number().int().min(5).max(60).default(15),
  logFilters: z
    .object({
      joins: z.boolean().default(true),
      success: z.boolean().default(true),
      failures: z.boolean().default(true),
      cooldowns: z.boolean().default(true),
      accountAge: z.boolean().default(true),
      resets: z.boolean().default(true),
    })
    .default({ joins: true, success: true, failures: true, cooldowns: true, accountAge: true, resets: true }),
});

export const aiPricingEntrySchema = z.object({
  model: z.string().min(1).max(100),
  inputPerMTokUsd: z.number().min(0).max(1000),
  outputPerMTokUsd: z.number().min(0).max(1000),
  /** Where the admin got this number and when; prices change, so these are editable estimates. */
  note: z.string().max(200).default(''),
});

export const aiSettingsSchema = z.object({
  outputChannelId: optSnowflake,
  triggers: z
    .object({
      mention: z.boolean().default(true),
      words: z.array(z.string().min(1).max(32).regex(/^[\p{L}\p{N}_-]+$/u)).max(20).default(['help', 'apple']),
      roleIds: snowflakes.default([AI_TRIGGER_ROLE_ID_DEFAULT]),
    })
    .default({ mention: true, words: ['help', 'apple'], roleIds: [AI_TRIGGER_ROLE_ID_DEFAULT] }),
  persona: z
    .string()
    .max(4000)
    .default('You are a friendly, concise helper for this Discord server. You answer questions using the provided server context and cite sources.'),
  tone: z.enum(['friendly', 'concise', 'formal', 'playful']).default('friendly'),
  indexingNoticeAcknowledged: z.boolean().default(false),
  learning: z
    .object({ autoLearn: z.boolean().default(true), paused: z.boolean().default(false) })
    .default({ autoLearn: true, paused: false }),
  retrieval: z
    .object({
      maxSources: z.number().int().min(1).max(30).default(8),
      recentTurns: z.number().int().min(0).max(20).default(6),
    })
    .default({ maxSources: 8, recentTurns: 6 }),
  vision: z
    .object({ enabled: z.boolean().default(true), maxBytes: z.number().int().min(100_000).max(20_000_000).default(8_000_000) })
    .default({ enabled: true, maxBytes: 8_000_000 }),
  escalation: z
    .object({ enabled: z.boolean().default(false), minQuestionChars: z.number().int().min(50).max(4000).default(400) })
    .default({ enabled: false, minQuestionChars: 400 }),
  budget: z
    .object({
      monthlyTargetUsd: z.number().min(0).max(100000).default(10),
      warnAtUsd: z.number().min(0).max(100000).default(8),
      lowCostAtUsd: z.number().min(0).max(100000).default(9.5),
      hardStopUsd: z.number().min(0).max(100000).default(10),
      hardStopEnabled: z.boolean().default(true),
    })
    .default({ monthlyTargetUsd: 10, warnAtUsd: 8, lowCostAtUsd: 9.5, hardStopUsd: 10, hardStopEnabled: true }),
  pricing: z.array(aiPricingEntrySchema).max(50).default([]),
  limits: z
    .object({
      perUserPerMinute: z.number().int().min(1).max(60).default(6),
      concurrentPerUser: z.number().int().min(1).max(5).default(1),
      globalPerMinute: z.number().int().min(1).max(1000).default(60),
    })
    .default({ perUserPerMinute: 6, concurrentPerUser: 1, globalPerMinute: 60 }),
});

export const emptySettingsSchema = z.object({}).passthrough();

export const giveawaySettingsSchema = z.object({
  /** Optional role pinged when a giveaway starts. */
  pingRoleId: optSnowflake,
  /** Longest giveaway staff can start, in days. */
  maxDurationDays: z.number().int().min(1).max(60).default(30),
});

export const pollSettingsSchema = z.object({
  /** Longest poll, in hours (Discord allows up to 32 days). */
  maxDurationHours: z.number().int().min(1).max(768).default(168),
});

export const reminderSettingsSchema = z.object({
  maxPerUser: z.number().int().min(1).max(100).default(25),
  /** Let members post reminders in a channel instead of only by DM. */
  allowChannelReminders: z.boolean().default(true),
});

/** A unicode emoji like ⭐, or a custom emoji as `<:name:id>` or its bare id. */
const reactionEmoji = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((v) => /^<a?:\w{2,32}:\d{17,20}>$/.test(v) || /^\d{17,20}$/.test(v) || (!/\s/.test(v) && /\p{Extended_Pictographic}/u.test(v)), 'Use one emoji, or a custom emoji like <:star:123…>');

export const starboardSettingsSchema = z.object({
  channelId: optSnowflake,
  emoji: reactionEmoji.default('⭐'),
  threshold: z.number().int().min(1).max(100).default(3),
  allowSelfStar: z.boolean().default(false),
  ignoredChannelIds: snowflakes,
  /** Age-restricted channels only reach the starboard when this is on. */
  includeNsfw: z.boolean().default(false),
});

export const suggestionSettingsSchema = z.object({
  channelId: optSnowflake,
  /** Added under every suggestion, in this order. */
  reactions: z.array(reactionEmoji).max(5).default(['✅', '➖', '❌']),
  /** Post through a channel webhook with the member's name and avatar instead of as the bot. */
  postAsMember: z.boolean().default(true),
  cooldownSeconds: z.number().int().min(0).max(3600).default(60),
});

export type MusicSettings = z.infer<typeof musicSettingsSchema>;
export type StarboardSettings = z.infer<typeof starboardSettingsSchema>;
export type SuggestionSettings = z.infer<typeof suggestionSettingsSchema>;
export type TempVcSettings = z.infer<typeof tempVcSettingsSchema>;
export type LevelingSettings = z.infer<typeof levelingSettingsSchema>;
export type ModerationSettings = z.infer<typeof moderationSettingsSchema>;
export type TicketSettings = z.infer<typeof ticketSettingsSchema>;
export type WelcomeSettings = z.infer<typeof welcomeSettingsSchema>;
export type VerificationSettings = z.infer<typeof verificationSettingsSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type AiPricingEntry = z.infer<typeof aiPricingEntrySchema>;
