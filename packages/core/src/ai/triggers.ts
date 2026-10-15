/**
 * AI trigger detection for the ONE configured AI output channel.
 * Triggers: bot mention, standalone words (default `help`, `apple`), or a
 * mention of a configured role (default 1551266433604780221).
 * Case-insensitive with real word boundaries: `pineapple` / `helpful` do not match.
 */

export interface TriggerConfig {
  mention: boolean;
  words: string[];
  roleIds: string[];
}

export interface TriggerMessage {
  content: string;
  channelId: string;
  authorId: string;
  authorIsBot: boolean;
  isWebhook: boolean;
  isSystem?: boolean;
  mentionedUserIds: string[];
  mentionedRoleIds: string[];
}

export type TriggerReason = 'mention' | 'word' | 'role';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Standalone-word test using Unicode letter/number boundaries. */
export function containsWholeWord(text: string, word: string): boolean {
  const w = word.trim();
  if (!w) return false;
  // Strip mentions/emoji markup so `<@123>` digits don't matter, keep plain text.
  const cleaned = text.replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>/g, ' ');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(w)}(?![\\p{L}\\p{N}_])`, 'iu').test(cleaned);
}

export function detectTriggers(msg: TriggerMessage, cfg: TriggerConfig, botId: string): TriggerReason[] {
  const reasons = new Set<TriggerReason>();
  if (cfg.mention && (msg.mentionedUserIds.includes(botId) || new RegExp(`<@!?${botId}>`).test(msg.content))) reasons.add('mention');
  if (cfg.words.some((w) => containsWholeWord(msg.content, w))) reasons.add('word');
  if (cfg.roleIds.some((r) => msg.mentionedRoleIds.includes(r) || msg.content.includes(`<@&${r}>`))) reasons.add('role');
  return [...reasons];
}

/**
 * Should the bot answer this message? Only in the configured output channel,
 * never for bots/webhooks/system messages or itself (prevents loops).
 * Multiple triggers in one message yield a single response.
 */
export function shouldRespond(msg: TriggerMessage, cfg: TriggerConfig, botId: string, outputChannelId: string | undefined): { respond: boolean; reasons: TriggerReason[] } {
  if (!outputChannelId || msg.channelId !== outputChannelId) return { respond: false, reasons: [] };
  if (msg.authorIsBot || msg.isWebhook || msg.isSystem || msg.authorId === botId) return { respond: false, reasons: [] };
  const reasons = detectTriggers(msg, cfg, botId);
  return { respond: reasons.length > 0, reasons };
}

/** Remove the trigger mention from the question text so the model sees the actual question. */
export function extractQuestion(content: string, botId: string, roleIds: string[]): string {
  let q = content.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ');
  for (const r of roleIds) q = q.split(`<@&${r}>`).join(' ');
  return q.replace(/\s{2,}/g, ' ').trim();
}

/** Hard guard used right before any AI send: output is confined to one channel. */
export function assertAiOutputChannel(targetChannelId: string, outputChannelId: string | undefined): void {
  if (!outputChannelId || targetChannelId !== outputChannelId) {
    throw new Error('AI output is only allowed in the configured AI channel');
  }
}
