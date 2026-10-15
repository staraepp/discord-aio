import { MessageFlags, MessageFlagsBitField, type MessageCreateOptions } from 'discord.js';
import type { PanelKind } from '@aio/db';
import type { BotContext } from './context.js';
import { botCanSend, textChannel } from './discord.js';

/**
 * Persistent panels (verification, tickets, temp VC creator, role panels, …).
 * Message IDs are stored so panels are edited in place and repaired when
 * deleted, instead of re-posted on every restart.
 */
export async function upsertPanelMessage(ctx: BotContext, p: { kind: PanelKind; refId: string; channelId: string; options: MessageCreateOptions }): Promise<string> {
  const guild = ctx.requireGuild();
  const channel = textChannel(guild, p.channelId);
  if (!channel) throw new Error('The panel channel does not exist or is not a text channel.');
  if (!botCanSend(guild, channel)) throw new Error(`The bot cannot send messages in #${channel.name}. Check its permissions.`);
  const existing = await ctx.db.persistentPanel.findUnique({ where: { kind_refId: { kind: p.kind, refId: p.refId } } });

  if (existing?.messageId && existing.channelId === p.channelId) {
    const msg = await channel.messages.fetch(existing.messageId).catch(() => null);
    const wantsV2 = new MessageFlagsBitField(p.options.flags as never).has(MessageFlags.IsComponentsV2);
    // Discord can't switch a message between classic and Components V2 layouts, so re-post instead.
    if (msg && msg.flags.has(MessageFlags.IsComponentsV2) !== wantsV2) await msg.delete().catch(() => undefined);
    else if (msg) {
      await msg.edit(
        wantsV2
          ? { components: p.options.components ?? [], files: p.options.files ?? [], attachments: [], allowedMentions: p.options.allowedMentions }
          : { content: p.options.content ?? null, embeds: p.options.embeds ?? [], components: p.options.components ?? [], files: p.options.files ?? [], attachments: [], allowedMentions: p.options.allowedMentions },
      );
      return msg.id;
    }
  } else if (existing?.messageId) {
    const old = textChannel(guild, existing.channelId);
    await old?.messages.delete(existing.messageId).catch(() => undefined);
  }
  const msg = await channel.send(p.options);
  await ctx.db.persistentPanel.upsert({
    where: { kind_refId: { kind: p.kind, refId: p.refId } },
    create: { guildId: ctx.guildId, kind: p.kind, refId: p.refId, channelId: channel.id, messageId: msg.id },
    update: { channelId: channel.id, messageId: msg.id },
  });
  return msg.id;
}

export async function deletePanelMessage(ctx: BotContext, kind: PanelKind, refId: string): Promise<void> {
  const existing = await ctx.db.persistentPanel.findUnique({ where: { kind_refId: { kind, refId } } });
  if (!existing) return;
  const guild = ctx.guild();
  if (guild && existing.messageId) await textChannel(guild, existing.channelId)?.messages.delete(existing.messageId).catch(() => undefined);
  await ctx.db.persistentPanel.delete({ where: { id: existing.id } });
}

/** Startup check: report panels whose message disappeared so the owner can see it in diagnostics. */
export async function auditPanels(ctx: BotContext): Promise<{ missing: number; total: number }> {
  const guild = ctx.guild();
  const panels = await ctx.db.persistentPanel.findMany({ where: { guildId: ctx.guildId } });
  let missing = 0;
  for (const p of panels) {
    const ch = guild ? textChannel(guild, p.channelId) : null;
    const msg = ch && p.messageId ? await ch.messages.fetch(p.messageId).catch(() => null) : null;
    if (!msg) {
      missing++;
      await ctx.db.persistentPanel.update({ where: { id: p.id }, data: { messageId: null } });
    }
  }
  return { missing, total: panels.length };
}
