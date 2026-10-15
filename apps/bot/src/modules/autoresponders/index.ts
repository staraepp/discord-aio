import type { GuildTextBasedChannel, Message } from 'discord.js';
import { actionSpecSchema, CooldownMap, runActions, type ActionSpec } from '@aio/core';
import { findMatchingRule, pickResponse, type AutoresponderRule, type MatchMode } from '@aio/core/autoresponder';
import type { Autoresponder, AutoresponderAction } from '@aio/db';
import type { BotContext } from '../../runtime/context.js';
import { createActionExecutor, variableContext } from '../../runtime/actions.js';

type Rule = Autoresponder & { actions: AutoresponderAction[] } & AutoresponderRule;

let cache: { at: number; rules: Rule[] } | null = null;
const cooldowns = new CooldownMap();

export function invalidateAutoresponders(): void {
  cache = null;
}

async function rules(ctx: BotContext): Promise<Rule[]> {
  if (cache && Date.now() - cache.at < 10_000) return cache.rules;
  const rows = await ctx.db.autoresponder.findMany({ where: { guildId: ctx.guildId, enabled: true }, include: { actions: { orderBy: { position: 'asc' } } } });
  cache = { at: Date.now(), rules: rows.map((r) => ({ ...r, matchMode: r.matchMode as MatchMode })) };
  return cache.rules;
}

export async function handleAutoresponders(ctx: BotContext, message: Message<true>): Promise<void> {
  if (!(await ctx.module('autoresponders')).enabled) return;
  const member = message.member;
  if (!member || message.author.bot || message.webhookId) return;
  const channel = message.channel as GuildTextBasedChannel;
  const parentId = 'parentId' in channel && channel.isThread() ? (channel.parentId ?? undefined) : undefined;
  const rule = findMatchingRule(await rules(ctx), { content: message.content, channelId: channel.id, parentChannelId: parentId, roleIds: [...member.roles.cache.keys()] });
  if (!rule) return;
  const cdKey = `${rule.id}:${member.id}`;
  if (cooldowns.isCooling(cdKey)) return;
  cooldowns.set(cdKey, rule.cooldownSeconds * 1000);

  const vctx = variableContext(member, channel, message);
  const actions: ActionSpec[] = [];
  if (rule.responseType === 'text' || rule.responseType === 'random') {
    const text = rule.responseType === 'random' ? pickResponse(rule.responses) : rule.responses[0];
    if (text) actions.push({ type: 'send_text', text });
  } else if (rule.responseType === 'embed' && rule.embedId) {
    actions.push({ type: 'send_embed', embedId: rule.embedId });
  }
  for (const a of rule.actions) {
    const parsed = actionSpecSchema.safeParse({ type: a.type, ...(a.config as object) });
    if (parsed.success) actions.push(parsed.data);
  }
  if (rule.deleteResponseAfterSeconds) actions.push({ type: 'delete_response_after', seconds: rule.deleteResponseAfterSeconds });
  if (rule.deleteTrigger) actions.push({ type: 'delete_trigger' });

  const results = await runActions(actions, createActionExecutor(ctx, { member, channel, trigger: message }), vctx, `Autoresponder: ${rule.name}`);
  if (rule.logUses) {
    await ctx.audit({ actorId: member.id, actorType: 'bot', module: 'autoresponders', action: 'autoresponder.fired', targetId: rule.id, meta: { name: rule.name, channelId: channel.id, results } });
  }
}
