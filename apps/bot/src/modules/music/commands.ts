import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import { FILTER_PRESETS, escapeMd, findSessionByVoice, truncate, type MusicActor, type MusicResult, type LoopMode } from '@aio/core/music';
import { parseTimestamp } from '@aio/discord-ui';
import type { BotContext } from '../../runtime/context.js';
import { ephemeral, ts } from '../../runtime/discord.js';
import type { BotModule, SlashCommand } from '../../commands/types.js';
import type { MusicRuntime } from './runtime.js';
import { card } from '../../runtime/cards.js';
import { addedCard } from './cards.js';
import { nowPlayingView, queueView } from './views.js';
import { choiceName } from './suggest.js';

export interface VoiceCtx {
  voiceChannelId: string;
  kind: 'public' | 'temp';
  actor: MusicActor;
}

/** Resolve the caller's voice room, room type and permissions. */
export async function voiceContext(ctx: BotContext, member: GuildMember): Promise<VoiceCtx | null> {
  const vc = member.voice.channelId;
  if (!vc) return null;
  const temp = await ctx.db.tempVoiceRoom.findFirst({ where: { channelId: vc, deletedAt: null } });
  return {
    voiceChannelId: vc,
    kind: temp ? 'temp' : 'public',
    actor: { userId: member.id, isStaff: await ctx.isMusicStaff(member), isRoomOwner: temp?.ownerId === member.id, inVoiceChannel: true },
  };
}

function music(ctx: BotContext): MusicRuntime {
  if (!ctx.music) throw new Error('Music runtime not started');
  return ctx.music;
}

async function reply(i: ChatInputCommandInteraction<'cached'>, r: MusicResult | string, ctx?: BotContext): Promise<void> {
  // Successful adds get a card with artwork, place in line and wait time.
  if (ctx && typeof r !== 'string' && r.ok && r.added) {
    const embeds = [await card(ctx, addedCard(r.added))];
    if (i.deferred || i.replied) await i.editReply({ content: '', embeds, allowedMentions: { parse: [] } });
    else await i.reply({ embeds, flags: 64, allowedMentions: { parse: [] } });
    return;
  }
  const text = typeof r === 'string' ? r : r.message;
  if (ctx) {
    // Plain strings are validation messages (bad timestamp and so on), so they count as warnings.
    const ok = typeof r !== 'string' && r.ok;
    const embeds = [await card(ctx, { tone: ok ? 'info' : 'warn', body: text })];
    if (i.deferred || i.replied) await i.editReply({ content: '', embeds, allowedMentions: { parse: [] } });
    else await i.reply({ embeds, flags: 64, allowedMentions: { parse: [] } });
    return;
  }
  if (i.deferred || i.replied) await i.editReply({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
  else await i.reply(ephemeral(text));
}

/** Wraps a session command: requires the caller to be in a voice channel. */
function sessionCommand(
  data: { toJSON(): SlashCommand['data'] },
  run: (i: ChatInputCommandInteraction<'cached'>, ctx: BotContext, v: VoiceCtx) => Promise<MusicResult | string>,
): SlashCommand {
  return {
    module: 'music',
    data: data.toJSON(),
    async execute(i, ctx) {
      const v = await voiceContext(ctx, i.member);
      if (!v) return i.reply(ephemeral('Join a voice channel first.'));
      await i.deferReply({ flags: 64 });
      return reply(i, await run(i, ctx, v), ctx);
    },
  };
}

const G = (ctx: BotContext) => ctx.guildId;

const play: SlashCommand = {
  module: 'music',
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist (YouTube search/link, Spotify or Apple Music link)')
    .addStringOption((o) => o.setName('query').setDescription('Song name or link').setRequired(true).setMaxLength(500).setAutocomplete(true))
    .toJSON(),
  suggestionsOnly: true,
  async autocomplete(i, ctx) {
    const typed = i.options.getFocused();
    // Nothing typed yet: offer the member's own recent songs.
    if (typed.trim().length < 2) {
      const recent = await ctx.db.musicHistory.findMany({ where: { guildId: G(ctx), requesterId: i.user.id }, orderBy: { playedAt: 'desc' }, take: 30 });
      const seen = new Set<string>();
      const choices = recent
        .map((r) => ({ name: choiceName(r.title, r.author, r.durationMs), value: r.uri && r.uri.length <= 100 ? r.uri : `${r.title} ${r.author}`.slice(0, 100) }))
        .filter((c) => !seen.has(c.value) && seen.add(c.value))
        .slice(0, 8);
      return i.respond(choices).catch(() => undefined);
    }
    return i.respond(await music(ctx).suggester.suggest(typed)).catch(() => undefined);
  },
  async execute(i, ctx) {
    const v = await voiceContext(ctx, i.member);
    if (!v) return i.reply(ephemeral('Join a voice channel first, then use `/play`.'));
    const settings = (await ctx.module('music')).settings;
    await i.deferReply({ flags: settings.ephemeralAcks ? 64 : undefined });
    const r = await music(ctx).service.play({ guildId: G(ctx), voiceChannelId: v.voiceChannelId, textChannelId: i.channelId, kind: v.kind, actor: v.actor, query: i.options.getString('query', true) });
    return reply(i, r, ctx);
  },
};

const forceplay = sessionCommand(
  new SlashCommandBuilder().setName('forceplay').setDescription('Staff: play a track immediately').addStringOption((o) => o.setName('query').setDescription('Song name or link').setRequired(true).setMaxLength(500)),
  async (i, ctx, v) => music(ctx).service.play({ guildId: G(ctx), voiceChannelId: v.voiceChannelId, textChannelId: i.channelId, kind: v.kind, actor: v.actor, query: i.options.getString('query', true), force: true }),
);

const queueData = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Show or search the queue for your voice channel')
  .addSubcommand((s) => s.setName('view').setDescription('Show the queue').addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1)))
  .addSubcommand((s) => s.setName('search').setDescription('Search the queue').addStringOption((o) => o.setName('query').setDescription('Title or artist').setRequired(true).setMaxLength(100)));

const queue: SlashCommand = {
  module: 'music',
  data: queueData.toJSON(),
  async execute(i, ctx) {
    const vc = i.member.voice.channelId;
    if (!vc) return i.reply(ephemeral('Join a voice channel to see its queue.'));
    const sub = i.options.getSubcommand();
    return i.reply(sub === 'search' ? await queueView(ctx, vc, 1, i.options.getString('query', true)) : await queueView(ctx, vc, i.options.getInteger('page') ?? 1));
  },
};

const q: SlashCommand = {
  module: 'music',
  data: new SlashCommandBuilder().setName('q').setDescription('Show the queue (shortcut)').addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1)).toJSON(),
  async execute(i, ctx) {
    const vc = i.member.voice.channelId;
    if (!vc) return i.reply(ephemeral('Join a voice channel to see its queue.'));
    return i.reply(await queueView(ctx, vc, i.options.getInteger('page') ?? 1));
  },
};

const nowplaying: SlashCommand = {
  module: 'music',
  data: new SlashCommandBuilder().setName('nowplaying').setDescription("What's playing in your voice channel right now").toJSON(),
  async execute(i, ctx) {
    const vc = i.member.voice.channelId;
    if (!vc) return i.reply(ephemeral('Join a voice channel to see what is playing there.'));
    return i.reply(await nowPlayingView(ctx, vc, (slot) => music(ctx).playback?.position(slot) ?? null));
  },
};

const history: SlashCommand = {
  module: 'music',
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Recently played songs')
    .addUserOption((o) => o.setName('user').setDescription('Only songs requested by this member'))
    .toJSON(),
  async execute(i, ctx) {
    const user = i.options.getUser('user');
    const rows = await ctx.db.musicHistory.findMany({ where: { guildId: G(ctx), ...(user ? { requesterId: user.id } : {}) }, orderBy: { playedAt: 'desc' }, take: 15 });
    if (!rows.length) return i.reply(ephemeral('No songs have been played yet.'));
    return i.reply(ephemeral(rows.map((r) => `${ts(r.playedAt)} **${escapeMd(truncate(r.title, 60))}** by ${escapeMd(truncate(r.author, 30))} · <@${r.requesterId}>`).join('\n')));
  },
};

const simple = (name: string, description: string, fn: (ctx: BotContext, v: VoiceCtx) => Promise<MusicResult>) =>
  sessionCommand(new SlashCommandBuilder().setName(name).setDescription(description), async (_i, ctx, v) => fn(ctx, v));

const skip = simple('skip', 'Skip the current song (your own, or any if you are staff)', (ctx, v) => music(ctx).service.skip(G(ctx), v.voiceChannelId, v.actor));
const forceskip = simple('forceskip', 'Staff: skip the current song', (ctx, v) => music(ctx).service.skip(G(ctx), v.voiceChannelId, v.actor, true));
const previous = simple('previous', 'Play the previous track', (ctx, v) => music(ctx).service.previous(G(ctx), v.voiceChannelId, v.actor));
const pause = simple('pause', 'Pause playback', (ctx, v) => music(ctx).service.pause(G(ctx), v.voiceChannelId, v.actor));
const resume = simple('resume', 'Resume playback (or reconnect a saved queue)', (ctx, v) => music(ctx).service.resume(G(ctx), v.voiceChannelId, v.actor));
const stop = simple('stop', 'Staff: stop, clear the queue and leave', (ctx, v) => music(ctx).service.stop(G(ctx), v.voiceChannelId, v.actor));
const shuffle = simple('shuffle', 'Shuffle upcoming tracks', (ctx, v) => music(ctx).service.shuffle(G(ctx), v.voiceChannelId, v.actor));
const disconnect = simple('disconnect', 'Staff: leave the channel and keep the queue', (ctx, v) => music(ctx).service.disconnect(G(ctx), v.voiceChannelId, v.actor));

const loop = sessionCommand(
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set loop mode')
    .addStringOption((o) => o.setName('mode').setDescription('Loop mode').setRequired(true).addChoices({ name: 'Off', value: 'off' }, { name: 'Track', value: 'track' }, { name: 'Queue', value: 'queue' })),
  async (i, ctx, v) => music(ctx).service.setLoop(G(ctx), v.voiceChannelId, v.actor, i.options.getString('mode', true) as LoopMode),
);

const volume = sessionCommand(
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set volume (0–200%, steps of 10)')
    .addIntegerOption((o) => o.setName('percent').setDescription('0–200').setRequired(true).setMinValue(0).setMaxValue(200)),
  async (i, ctx, v) => music(ctx).service.setVolume(G(ctx), v.voiceChannelId, v.actor, i.options.getInteger('percent', true)),
);

const seek = sessionCommand(
  new SlashCommandBuilder().setName('seek').setDescription('Jump to a timestamp, e.g. 1:32').addStringOption((o) => o.setName('time').setDescription('Timestamp like 1:32 or 90').setRequired(true).setMaxLength(12)),
  async (i, ctx, v) => {
    const ms = parseTimestamp(i.options.getString('time', true));
    if (ms === undefined) return 'Use a timestamp like `1:32`, `1:02:03` or `90`.';
    return music(ctx).service.seek(G(ctx), v.voiceChannelId, v.actor, ms);
  },
);

const remove = sessionCommand(
  new SlashCommandBuilder().setName('remove').setDescription('Remove a queued track').addIntegerOption((o) => o.setName('position').setDescription('Queue position').setRequired(true).setMinValue(1)),
  async (i, ctx, v) => music(ctx).service.remove(G(ctx), v.voiceChannelId, v.actor, i.options.getInteger('position', true)),
);

const move = sessionCommand(
  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a queued track')
    .addIntegerOption((o) => o.setName('from').setDescription('Current position').setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName('to').setDescription('New position').setRequired(true).setMinValue(1)),
  async (i, ctx, v) => music(ctx).service.move(G(ctx), v.voiceChannelId, v.actor, i.options.getInteger('from', true), i.options.getInteger('to', true)),
);

const clear: SlashCommand = {
  module: 'music',
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear queued tracks')
    .addSubcommand((s) => s.setName('mine').setDescription('Remove all of your queued tracks'))
    .addSubcommand((s) => s.setName('all').setDescription('Staff: clear the whole queue'))
    .toJSON(),
  async execute(i, ctx) {
    const v = await voiceContext(ctx, i.member);
    if (!v) return i.reply(ephemeral('Join the voice channel first.'));
    return reply(i, await music(ctx).service.clear(G(ctx), v.voiceChannelId, v.actor, i.options.getSubcommand() === 'mine'));
  },
};

const jump = sessionCommand(
  new SlashCommandBuilder().setName('jump').setDescription('Staff: play a queued track now').addIntegerOption((o) => o.setName('position').setDescription('Queue position').setRequired(true).setMinValue(1)),
  async (i, ctx, v) => music(ctx).service.jump(G(ctx), v.voiceChannelId, v.actor, i.options.getInteger('position', true)),
);

const filter = sessionCommand(
  new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Audio filter preset (if the audio backend supports it)')
    .addStringOption((o) =>
      o
        .setName('preset')
        .setDescription('Preset')
        .setRequired(true)
        .addChoices(...Object.entries(FILTER_PRESETS).map(([value, p]) => ({ name: p.label, value }))),
    ),
  async (i, ctx, v) => music(ctx).service.setFilter(G(ctx), v.voiceChannelId, v.actor, i.options.getString('preset', true)),
);

const lyrics: SlashCommand = {
  module: 'music',
  data: new SlashCommandBuilder().setName('lyrics').setDescription('Show lyrics for the current song (synced when available)').toJSON(),
  async execute(i, ctx) {
    const vc = i.member.voice.channelId;
    const s = vc ? await findSessionByVoice(ctx.db, G(ctx), vc) : null;
    if (!s) return i.reply(ephemeral('Join a voice channel with music playing.'));
    await i.deferReply({ flags: 64 });
    return i.editReply({ content: await music(ctx).lyricsText(s.id), allowedMentions: { parse: [] } });
  },
};

const musicAdmin: SlashCommand = {
  module: 'music',
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music settings for your current room')
    .addSubcommand((s) => s.setName('247').setDescription('Staff: keep the player connected').addBooleanOption((o) => o.setName('enabled').setDescription('On/off').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Show music players and their rooms'))
    .toJSON(),
  async execute(i, ctx) {
    if (i.options.getSubcommand() === 'status') {
      const rt = music(ctx);
      if (!rt.configured) return i.reply(ephemeral('Music playback is **not configured** yet (there is no Lavalink audio backend) 😔 Staff can set LAVALINK_URL and LAVALINK_PASSWORD.'));
      const slots = rt.playback!.onlineSlots();
      const sessions = await ctx.db.musicSession.findMany({ where: { identitySlot: { not: null } } });
      const lines = [1, 2, 3].map((slot) => {
        const s = sessions.find((x) => x.identitySlot === slot);
        const err = rt.identityErrors.get(slot);
        return `Player #${slot}: ${slots.includes(slot) ? (s ? `playing in <#${s.voiceChannelId}>` : 'free') : err ? `error: ${err}` : 'not configured or offline'}`;
      });
      return i.reply(ephemeral(lines.join('\n')));
    }
    const v = await voiceContext(ctx, i.member);
    if (!v) return i.reply(ephemeral('Join the voice channel first.'));
    return reply(i, await music(ctx).service.toggle247(G(ctx), v.voiceChannelId, v.actor, i.options.getBoolean('enabled', true)));
  },
};

export const musicCommands: BotModule = {
  commands: [play, forceplay, queue, q, nowplaying, history, skip, forceskip, previous, pause, resume, stop, loop, shuffle, volume, seek, lyrics, remove, move, clear, jump, disconnect, filter, musicAdmin],
};

