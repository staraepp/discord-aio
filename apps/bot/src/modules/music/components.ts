import type { InteractionReplyOptions, InteractionUpdateOptions, MessageComponentInteraction } from 'discord.js';
import type { LoopMode, MusicActor, MusicResult } from '@aio/core/music';
import type { BotModule } from '../../commands/types.js';
import { ephemeral } from '../../runtime/discord.js';
import { cardReply } from '../../runtime/cards.js';

/** A reply payload reused to edit the message in place (flags can't change on update). */
function toUpdate(r: InteractionReplyOptions): InteractionUpdateOptions {
  const { flags: _flags, ...rest } = r as InteractionReplyOptions & { flags?: unknown };
  return rest as InteractionUpdateOptions;
}
import { queueView } from './views.js';

/** Now Playing panel buttons/selects: `mp:<action>:<sessionId>`. Same permission checks as commands. */
export const musicComponents: BotModule = {
  components: [
    {
      // Queue page buttons: `mq:<voiceChannelId>:<page>`. Anyone who can see the queue can page it.
      prefix: 'mq',
      module: 'music',
      async handle(i, ctx, [voiceChannelId, page]) {
        if (!i.isButton() || !voiceChannelId) return;
        return i.update(toUpdate(await queueView(ctx, voiceChannelId, Number(page) || 1)));
      },
    },
    {
      prefix: 'mp',
      module: 'music',
      async handle(i, ctx, [action, sessionId]) {
        if (!i.isMessageComponent() || !sessionId || !ctx.music) return;
        const session = await ctx.db.musicSession.findUnique({ where: { id: sessionId } });
        if (!session) return i.reply(ephemeral('This music session no longer exists.'));
        const temp = await ctx.db.tempVoiceRoom.findFirst({ where: { channelId: session.voiceChannelId, deletedAt: null } });
        const actor: MusicActor = {
          userId: i.user.id,
          isStaff: await ctx.isMusicStaff(i.member),
          isRoomOwner: temp?.ownerId === i.user.id,
          inVoiceChannel: i.member.voice.channelId === session.voiceChannelId,
        };
        const svc = ctx.music.service;
        const g = session.guildId;
        const vc = session.voiceChannelId;
        const selected = (i as MessageComponentInteraction).isStringSelectMenu() ? (i as MessageComponentInteraction & { values: string[] }).values[0] : undefined;
        let r: MusicResult | string;
        switch (action) {
          case 'prev':
            r = await svc.previous(g, vc, actor);
            break;
          case 'pause':
            r = await svc.pause(g, vc, actor);
            break;
          case 'resume':
            r = await svc.resume(g, vc, actor);
            break;
          case 'skip':
            r = await svc.skip(g, vc, actor);
            break;
          case 'shuffle':
            r = await svc.shuffle(g, vc, actor);
            break;
          case 'stop':
            r = await svc.stop(g, vc, actor);
            break;
          case 'loop':
            r = await svc.setLoop(g, vc, actor, (selected ?? 'off') as LoopMode);
            break;
          case 'volume':
            r = await svc.setVolume(g, vc, actor, Number(selected ?? 100));
            break;
          case 'queue':
            return i.reply(await queueView(ctx, vc, 1));
          case 'lyrics': {
            const text = await ctx.music.lyricsText(sessionId);
            const canFollow = actor.isStaff || actor.isRoomOwner;
            const follow = canFollow && actor.inVoiceChannel ? ctx.music.toggleLyricsFollow(sessionId) : null;
            const suffix = follow === null ? '' : follow ? '\n-# Live lyrics turned on in this chat (updates with the panel).' : '\n-# Live lyrics turned off.';
            return i.reply(ephemeral(`${text}${suffix}`.slice(0, 2000)));
          }
          default:
            return i.reply(ephemeral('Unknown control.'));
        }
        const text = typeof r === 'string' ? r : r.message;
        return i.reply(await cardReply(ctx, { tone: typeof r !== 'string' && r.ok ? 'info' : 'warn', body: text }));
      },
    },
  ],
};
