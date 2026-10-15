import type { APIActionRowComponent, APIButtonComponent, InteractionReplyOptions } from 'discord.js';
import { escapeMd, findSessionByVoice, loadSession, pendingEntries, sourceLabel, toTimeline, truncate } from '@aio/core/music';
import { formatDuration, renderTimeline } from '@aio/discord-ui';
import type { BotContext } from '../../runtime/context.js';
import { card } from '../../runtime/cards.js';
import { jumpUrl } from '../../runtime/discord.js';

const PER_PAGE = 10;
const LOOP_TEXT = { off: 'Loop off', track: 'Looping this track', queue: 'Looping the queue' } as const;

/** Custom id for queue page buttons: `mq:<voiceChannelId>:<page>`. */
export const queuePageId = (voiceChannelId: string, page: number) => `mq:${voiceChannelId}:${page}`;

function pageButtons(voiceChannelId: string, page: number, pages: number): APIActionRowComponent<APIButtonComponent> {
  return {
    type: 1,
    components: [
      { type: 2, style: 2, label: 'Previous', custom_id: queuePageId(voiceChannelId, page - 1), disabled: page <= 1 },
      { type: 2, style: 2, label: `Page ${page} of ${pages}`, custom_id: `mq:${voiceChannelId}:${page}:label`, disabled: true },
      { type: 2, style: 2, label: 'Next', custom_id: queuePageId(voiceChannelId, page + 1), disabled: page >= pages },
    ],
  };
}

/** The queue of a voice room as a card with page buttons. `filter` searches titles and artists. */
export async function queueView(ctx: BotContext, voiceChannelId: string, page: number, filter?: string): Promise<InteractionReplyOptions> {
  const found = await findSessionByVoice(ctx.db, ctx.guildId, voiceChannelId);
  if (!found) return { embeds: [await card(ctx, { body: 'Nothing is playing in this voice channel. Start something with `/play`.' })], flags: 64 };
  const s = (await loadSession(ctx.db, found.id))!;
  const t = toTimeline(s, s.entries);
  const cur = s.state === 'idle' || s.state === 'stopped' ? undefined : t.entries.find((e) => e.position === t.cursor);
  const all = pendingEntries(t);
  let rows = all.map((e, idx) => ({ e, place: idx + 1 }));
  if (filter) {
    const f = filter.toLowerCase();
    rows = rows.filter(({ e }) => e.title.toLowerCase().includes(f) || e.author.toLowerCase().includes(f));
  }
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const p = Math.min(Math.max(1, page), pages);
  const lines = rows
    .slice((p - 1) * PER_PAGE, p * PER_PAGE)
    .map(({ e, place }) => `\`${String(place).padStart(2)}\` **${escapeMd(truncate(e.title, 55))}** · ${escapeMd(truncate(e.author, 28))} · ${e.isStream ? 'LIVE' : formatDuration(e.durationMs)} · <@${e.requesterId}>`);

  const knownTotal = all.every((e) => !e.isStream && e.durationMs);
  const total = all.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  const now = cur ? `**Now:** ${escapeMd(truncate(cur.title, 70))} · <@${cur.requesterId}>` : '**Now:** nothing playing';
  const suspended = s.state === 'suspended' ? '\nEveryone left so I stopped for now, but the queue is saved 😔 Use `/resume` to pick it back up.' : '';
  const empty = filter ? `No queued songs match “${escapeMd(filter)}”.` : 'Nothing queued after this one.';

  const embed = await card(ctx, {
    eyebrow: filter ? `Queue search: ${truncate(filter, 60)}` : 'Queue',
    title: all.length === 0 ? 'Up next: nothing yet' : `${all.length} song${all.length === 1 ? '' : 's'} up next${knownTotal ? ` · ${formatDuration(total)}` : ''}`,
    body: `${now}${suspended}\n\n${lines.length ? lines.join('\n') : empty}`,
    footer: `${LOOP_TEXT[s.loopMode as keyof typeof LOOP_TEXT] ?? 'Loop off'} · Volume ${s.volume}%`,
  });
  // Filtered results stay on one page: the buttons page through the whole queue.
  return { embeds: [embed], components: pages > 1 && !filter ? [pageButtons(voiceChannelId, p, pages)] : [], flags: 64, allowedMentions: { parse: [] } };
}

/** What's playing in a voice room right now, with progress and a link to the live panel. */
export async function nowPlayingView(ctx: BotContext, voiceChannelId: string, positionOf: (slot: number) => number | null): Promise<InteractionReplyOptions> {
  const found = await findSessionByVoice(ctx.db, ctx.guildId, voiceChannelId);
  const s = found ? await loadSession(ctx.db, found.id) : null;
  const t = s ? toTimeline(s, s.entries) : null;
  const cur = s && t && s.state !== 'idle' && s.state !== 'stopped' ? t.entries.find((e) => e.position === t.cursor) : undefined;
  if (!s || !t || !cur) return { embeds: [await card(ctx, { body: 'Nothing is playing in this voice channel. Start something with `/play`.' })], flags: 64 };

  const pos = s.identitySlot !== null ? (positionOf(s.identitySlot) ?? s.positionMs) : s.positionMs;
  const next = pendingEntries(t)[0];
  const panel = await ctx.db.musicNowPlayingPanel.findUnique({ where: { sessionId: s.id } });
  const state = s.state === 'paused' ? 'Paused' : s.state === 'suspended' ? 'Stopped for now, queue saved' : 'Playing';
  const embed = await card(ctx, {
    eyebrow: state,
    title: truncate(cur.title, 250),
    url: cur.uri,
    body: `by **${escapeMd(truncate(cur.author, 60))}** · ${sourceLabel(cur.sourceName)}\n\n\`${renderTimeline(pos, cur.isStream ? null : cur.durationMs)}\``,
    fields: [
      { name: 'Requested by', value: `<@${cur.requesterId}>`, inline: true },
      { name: 'Up next', value: next ? `${escapeMd(truncate(next.title, 60))}` : 'Nothing queued', inline: true },
    ],
    thumbnail: cur.artworkUrl,
    notes: [cur.substitutionNote ?? '', panel?.messageId ? `[Open the player](${jumpUrl(ctx.guildId, panel.channelId, panel.messageId)}) for the buttons` : ''],
  });
  return { embeds: [embed], flags: 64, allowedMentions: { parse: [] } };
}
