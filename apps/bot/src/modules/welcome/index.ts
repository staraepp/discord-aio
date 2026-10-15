import type { GuildMember, PartialGuildMember } from 'discord.js';
import { loadSavedEmbed } from '@aio/core/embeds';
import { composeGreeting } from '@aio/core/welcome';
import { renderMessageTemplate } from '@aio/discord-ui';
import type { BotContext } from '../../runtime/context.js';
import { sendRendered } from '../../runtime/discord.js';
import { variableContext } from '../../runtime/actions.js';

/** Welcome/goodbye reuse saved embeds + optional plain content. `{user}` pings, `{user.name}` does not. */
export async function sendGreeting(ctx: BotContext, member: GuildMember | PartialGuildMember, kind: 'welcome' | 'goodbye'): Promise<void> {
  const mod = await ctx.module('welcome');
  const s = mod.settings;
  const enabled = kind === 'welcome' ? s.welcomeEnabled : s.goodbyeEnabled;
  if (!mod.enabled || !enabled) return;
  const channelId = kind === 'welcome' ? s.welcomeChannelId : s.goodbyeChannelId;
  const embedId = kind === 'welcome' ? s.welcomeEmbedId : s.goodbyeEmbedId;
  const content = kind === 'welcome' ? s.welcomeContent : s.goodbyeContent;
  const saved = embedId ? await loadSavedEmbed(ctx.db, ctx.guildId, embedId) : null;
  const template = composeGreeting({ content, savedTemplate: saved?.template ?? null });
  if (!template || !member.user) return;
  const vctx = variableContext(member as GuildMember);
  const rendered = renderMessageTemplate({ ...template, components: [] }, vctx);
  await sendRendered(member.guild, channelId, rendered).catch((err) => ctx.reportError(err, `welcome.${kind}`));
}
