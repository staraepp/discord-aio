import type { z } from 'zod';
import type { PermissionName } from '@aio/permissions';
import {
  aiSettingsSchema,
  emptySettingsSchema,
  giveawaySettingsSchema,
  pollSettingsSchema,
  reminderSettingsSchema,
  starboardSettingsSchema,
  levelingSettingsSchema,
  moderationSettingsSchema,
  musicSettingsSchema,
  tempVcSettingsSchema,
  ticketSettingsSchema,
  verificationSettingsSchema,
  welcomeSettingsSchema,
} from '../settings/schemas';

export type ModuleId =
  | 'music'
  | 'tempvc'
  | 'embeds'
  | 'autoresponders'
  | 'leveling'
  | 'forms'
  | 'moderation'
  | 'tickets'
  | 'welcome'
  | 'verification'
  | 'rolepanels'
  | 'honeypot'
  | 'ai'
  | 'giveaways'
  | 'polls'
  | 'reminders'
  | 'starboard';

export type GatewayIntentName = 'Guilds' | 'GuildMembers' | 'GuildMessages' | 'GuildVoiceStates' | 'MessageContent' | 'GuildMessageReactions';

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  description: string;
  route: string;
  /** Top-level slash commands owned by this module; unregistered when disabled. */
  commands: string[];
  intents: GatewayIntentName[];
  botPermissions: PermissionName[];
  settingsSchema: z.ZodType;
  /** External services this module needs; shown as Not Configured when missing. */
  integrations: string[];
  defaultEnabled: boolean;
}

export const MODULES: ModuleDefinition[] = [
  {
    id: 'music',
    name: 'Music',
    description: 'Slash-first music with up to three concurrent rooms, persistent queues and a live Now Playing panel.',
    route: '/dashboard/music',
    commands: ['play', 'queue', 'q', 'nowplaying', 'history', 'skip', 'previous', 'pause', 'resume', 'stop', 'loop', 'shuffle', 'volume', 'seek', 'lyrics', 'remove', 'move', 'clear', 'forceplay', 'forceskip', 'jump', 'disconnect', 'filter', 'music'],
    intents: ['Guilds', 'GuildVoiceStates'],
    botPermissions: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'Connect', 'Speak'],
    settingsSchema: musicSettingsSchema,
    integrations: ['lavalink', 'lavalink-home', 'spotify', 'apple-music', 'music-bot-2', 'music-bot-3'],
    defaultEnabled: true,
  },
  {
    id: 'tempvc',
    name: 'Temporary VCs',
    description: 'Self-service voice rooms that clean themselves up when the last human leaves.',
    route: '/dashboard/tempvc',
    commands: ['room'],
    intents: ['Guilds', 'GuildVoiceStates'],
    botPermissions: ['ManageChannels', 'MoveMembers', 'ViewChannel', 'Connect', 'SendMessages'],
    settingsSchema: tempVcSettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'embeds',
    name: 'Embeds',
    description: 'Server-wide reusable message templates with a live visual editor.',
    route: '/dashboard/embeds',
    commands: ['embed'],
    intents: ['Guilds'],
    botPermissions: ['SendMessages', 'EmbedLinks'],
    settingsSchema: emptySettingsSchema,
    integrations: [],
    defaultEnabled: true,
  },
  {
    id: 'autoresponders',
    name: 'Autoresponders',
    description: 'Visual trigger → response rules with safe actions.',
    route: '/dashboard/autoresponders',
    commands: [],
    intents: ['Guilds', 'GuildMessages', 'MessageContent'],
    botPermissions: ['SendMessages', 'EmbedLinks', 'ManageMessages', 'AddReactions', 'ManageRoles'],
    settingsSchema: emptySettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'leveling',
    name: 'Leveling',
    description: 'Configurable XP and role rewards. Not an RPG.',
    route: '/dashboard/leveling',
    commands: ['rank', 'leaderboard', 'xp', 'level', 'levels'],
    intents: ['Guilds', 'GuildMessages', 'GuildVoiceStates'],
    botPermissions: ['SendMessages', 'EmbedLinks', 'ManageRoles'],
    settingsSchema: levelingSettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'forms',
    name: 'Forms',
    description: 'Public forms without Discord login, reviewed in the dashboard.',
    route: '/dashboard/forms',
    commands: [],
    intents: [],
    botPermissions: [],
    settingsSchema: emptySettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'moderation',
    name: 'Moderation',
    description: 'Staff tooling with cases, required reasons and no automatic escalation.',
    route: '/dashboard/moderation',
    commands: ['warn', 'warnings', 'modhistory', 'case', 'note', 'timeout', 'untimeout', 'kick', 'voicekick', 'ban', 'tempban', 'softban', 'unban', 'purge', 'slowmode', 'lock', 'unlock', 'lockdown'],
    intents: ['Guilds', 'GuildMembers', 'GuildMessages', 'MessageContent'],
    botPermissions: ['KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageChannels', 'MoveMembers'],
    settingsSchema: moderationSettingsSchema,
    integrations: [],
    defaultEnabled: true,
  },
  {
    id: 'tickets',
    name: 'Tickets',
    description: 'Staff-only closing, first-responder naming and multi-button panels.',
    route: '/dashboard/tickets',
    commands: ['ticket'],
    intents: ['Guilds', 'GuildMessages', 'MessageContent'],
    botPermissions: ['ManageChannels', 'ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'AttachFiles'],
    settingsSchema: ticketSettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'welcome',
    name: 'Welcome & Goodbye',
    description: 'Greeting and farewell messages built from saved templates.',
    route: '/dashboard/welcome',
    commands: [],
    intents: ['Guilds', 'GuildMembers'],
    botPermissions: ['SendMessages', 'EmbedLinks'],
    settingsSchema: welcomeSettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'verification',
    name: 'Verification',
    description: 'Accessible CAPTCHA gate with verification-only cooldowns. Never kicks or times out.',
    route: '/dashboard/verification',
    commands: ['verification'],
    intents: ['Guilds', 'GuildMembers'],
    botPermissions: ['ManageRoles', 'SendMessages', 'EmbedLinks'],
    settingsSchema: verificationSettingsSchema,
    integrations: ['turnstile'],
    defaultEnabled: false,
  },
  {
    id: 'rolepanels',
    name: 'Role Panels',
    description: 'Button, select-menu and reaction role panels.',
    route: '/dashboard/rolepanels',
    commands: [],
    intents: ['Guilds', 'GuildMessageReactions'],
    botPermissions: ['ManageRoles', 'SendMessages', 'EmbedLinks', 'AddReactions'],
    settingsSchema: emptySettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'honeypot',
    name: 'Honeypot',
    description: 'Opt-in trap channel with deliberately chosen actions.',
    route: '/dashboard/honeypot',
    commands: [],
    intents: ['Guilds', 'GuildMessages'],
    botPermissions: ['ManageMessages', 'KickMembers', 'BanMembers'],
    settingsSchema: emptySettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'ai',
    name: 'AI Helper',
    description: 'A helper that answers in one channel using allowlisted context. Never moderates.',
    route: '/dashboard/ai',
    commands: ['ai'],
    intents: ['Guilds', 'GuildMessages', 'MessageContent'],
    botPermissions: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'],
    settingsSchema: aiSettingsSchema,
    integrations: ['ai-encryption', 'google-ai'],
    defaultEnabled: false,
  },
  {
    id: 'giveaways',
    name: 'Giveaways',
    description: 'Button-entry giveaways that draw fair random winners on time, with rerolls.',
    route: '/dashboard/giveaways',
    commands: ['giveaway'],
    intents: ['Guilds', 'GuildMembers'],
    botPermissions: ['ViewChannel', 'SendMessages', 'EmbedLinks'],
    settingsSchema: giveawaySettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
  {
    id: 'polls',
    name: 'Polls',
    description: "Quick polls using Discord's built-in voting, with live results.",
    route: '/dashboard/polls',
    commands: ['poll'],
    intents: ['Guilds'],
    botPermissions: ['ViewChannel', 'SendMessages', 'SendPolls'],
    settingsSchema: pollSettingsSchema,
    integrations: [],
    defaultEnabled: true,
  },
  {
    id: 'reminders',
    name: 'Reminders',
    description: 'Personal reminders by DM or in a channel. They survive restarts.',
    route: '/dashboard/reminders',
    commands: ['remind'],
    intents: ['Guilds'],
    botPermissions: ['ViewChannel', 'SendMessages'],
    settingsSchema: reminderSettingsSchema,
    integrations: [],
    defaultEnabled: true,
  },
  {
    id: 'starboard',
    name: 'Starboard',
    description: 'Messages that get enough star reactions are showcased in a channel of their own.',
    route: '/dashboard/starboard',
    commands: [],
    intents: ['Guilds', 'GuildMessages', 'GuildMessageReactions'],
    botPermissions: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'],
    settingsSchema: starboardSettingsSchema,
    integrations: [],
    defaultEnabled: false,
  },
];

export const MODULE_IDS = MODULES.map((m) => m.id);

export function getModule(id: string): ModuleDefinition | undefined {
  return MODULES.find((m) => m.id === id);
}

export function isModuleId(id: string): id is ModuleId {
  return MODULE_IDS.includes(id as ModuleId);
}

/** Commands that are always available regardless of module state. */
export const CORE_COMMANDS = ['help', 'modules'];

/** Which top-level commands should be registered for a given enabled-module set. */
export function commandsForEnabledModules(enabled: Set<ModuleId>): Set<string> {
  const out = new Set<string>(CORE_COMMANDS);
  for (const m of MODULES) if (enabled.has(m.id)) m.commands.forEach((c) => out.add(c));
  return out;
}
