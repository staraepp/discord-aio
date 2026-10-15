import { DiscordAPIError, type MessageCreateOptions } from 'discord.js';
import { RateLimiter } from '@aio/core';
import { DM_LIMIT, dmFailureMessage, linkButtonsOnly, type DirectMessageInput } from '@aio/core/customize';
import { renderTemplate } from '@aio/variables';
import type { BotContext } from '../../runtime/context.js';
import { toMessageOptions } from '../../runtime/discord.js';
import { renderSavedEmbed, variableContext } from '../../runtime/actions.js';

/** Per admin, so one slip on the dashboard can't spam the whole server. */
const limiter = new RateLimiter(DM_LIMIT.count, DM_LIMIT.windowMs);

export class DirectMessageError extends Error {}

/**
 * Sends a DM from the main bot to a server member. Dashboard only, on purpose: there is no slash
 * command. Variables like {user.name} fill in with the recipient's details. Every sent DM is
 * written to the audit log with who sent it.
 */
export async function sendDirectMessage(ctx: BotContext, input: DirectMessageInput, actorId: string): Promise<{ messageId: string; recipient: string }> {
  const slot = limiter.consume(actorId);
  if (!slot.allowed) throw new DirectMessageError(`You've sent ${DM_LIMIT.count} DMs in the last minute. Try again in ${Math.ceil(slot.retryAfterMs / 1000)} seconds.`);
  const member = await ctx.requireGuild().members.fetch(input.userId).catch(() => null);
  if (!member) throw new DirectMessageError("That user isn't in the server, so the bot can't DM them.");
  if (member.user.bot) throw new DirectMessageError("Bots can't receive DMs.");

  const vars = variableContext(member);
  let options: MessageCreateOptions;
  if (input.embedId) {
    const rendered = await renderSavedEmbed(ctx, input.embedId, vars);
    if (!rendered) throw new DirectMessageError('That saved embed was deleted. Pick another one.');
    options = toMessageOptions({ ...rendered, components: linkButtonsOnly(rendered.components) });
  } else {
    options = { content: renderTemplate(input.content ?? '', vars).text.slice(0, 2000) };
  }

  const sent = await member.send({ ...options, allowedMentions: { parse: [] } }).catch((err: unknown) => {
    throw new DirectMessageError(dmFailureMessage(err instanceof DiscordAPIError ? err.code : null));
  });
  await ctx.audit({
    actorId,
    module: 'core',
    action: 'dm.send',
    targetId: member.id,
    meta: { embedId: input.embedId, preview: input.content ? input.content.slice(0, 200) : null, recipient: member.user.username },
  });
  return { messageId: sent.id, recipient: member.user.username };
}
