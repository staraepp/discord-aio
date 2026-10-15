import { Script, createContext } from 'node:vm';
import { z } from 'zod';
import { actionSpecSchema } from '../actions/index';

export type MatchMode = 'exact' | 'starts_with' | 'ends_with' | 'contains' | 'regex';

export const REGEX_MAX_PATTERN = 200;
export const REGEX_MAX_INPUT = 2000;
export const REGEX_TIMEOUT_MS = 25;

/**
 * Static screening for catastrophic-backtracking shapes. Combined with a hard
 * VM execution timeout, this bounds regex cost even for adversarial input.
 */
export function validateRegex(pattern: string): { ok: true } | { ok: false; reason: string } {
  if (pattern.length === 0) return { ok: false, reason: 'Pattern is empty.' };
  if (pattern.length > REGEX_MAX_PATTERN) return { ok: false, reason: `Pattern must be at most ${REGEX_MAX_PATTERN} characters.` };
  if (/\\\d/.test(pattern) || /\\k</.test(pattern)) return { ok: false, reason: 'Backreferences are not allowed.' };
  if (/\(\?<?[=!]/.test(pattern)) return { ok: false, reason: 'Lookaround assertions are not allowed.' };
  // Quantified group that itself contains a quantifier: (a+)+, (a*)*, (a|aa)+, (.*){2,}
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) {
    return { ok: false, reason: 'Nested quantifiers such as (a+)+ are not allowed.' };
  }
  if (/\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) {
    return { ok: false, reason: 'Quantified alternations such as (a|aa)+ are not allowed.' };
  }
  try {
    new RegExp(pattern, 'u');
  } catch (err) {
    return { ok: false, reason: `Invalid pattern: ${(err as Error).message}` };
  }
  return { ok: true };
}

const sandbox = createContext(Object.create(null));
const script = new Script('re.test(input)');

/** Executes a regex test with a hard timeout. Returns false on timeout. */
export function safeRegexTest(pattern: string, input: string, caseSensitive: boolean): { matched: boolean; timedOut: boolean } {
  const check = validateRegex(pattern);
  if (!check.ok) return { matched: false, timedOut: false };
  const re = new RegExp(pattern, caseSensitive ? 'u' : 'iu');
  (sandbox as Record<string, unknown>).re = re;
  (sandbox as Record<string, unknown>).input = input.slice(0, REGEX_MAX_INPUT);
  try {
    return { matched: Boolean(script.runInContext(sandbox, { timeout: REGEX_TIMEOUT_MS })), timedOut: false };
  } catch {
    return { matched: false, timedOut: true };
  }
}

export function matchesTrigger(content: string, trigger: string, mode: MatchMode, caseSensitive = false): boolean {
  if (mode === 'regex') return safeRegexTest(trigger, content, caseSensitive).matched;
  const text = caseSensitive ? content.trim() : content.trim().toLowerCase();
  const t = caseSensitive ? trigger.trim() : trigger.trim().toLowerCase();
  if (!t) return false;
  switch (mode) {
    case 'exact':
      return text === t;
    case 'starts_with':
      return text.startsWith(t);
    case 'ends_with':
      return text.endsWith(t);
    case 'contains':
      return text.includes(t);
  }
}

export interface AutoresponderRule {
  id: string;
  enabled: boolean;
  trigger: string;
  matchMode: MatchMode;
  caseSensitive: boolean;
  allowedChannelIds: string[];
  blockedChannelIds: string[];
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  priority: number;
}

/** Channel/role scoping rules: blocked lists win; empty allowed lists mean "everywhere". */
export function isInScope(rule: AutoresponderRule, channelId: string, roleIds: string[], parentChannelId?: string): boolean {
  const inChannel = (ids: string[]) => ids.includes(channelId) || (parentChannelId !== undefined && ids.includes(parentChannelId));
  if (inChannel(rule.blockedChannelIds)) return false;
  if (rule.allowedChannelIds.length > 0 && !inChannel(rule.allowedChannelIds)) return false;
  if (rule.blockedRoleIds.some((r) => roleIds.includes(r))) return false;
  if (rule.allowedRoleIds.length > 0 && !rule.allowedRoleIds.some((r) => roleIds.includes(r))) return false;
  return true;
}

/** First matching rule by priority (desc). One autoresponder fires per message to avoid spam chains. */
export function findMatchingRule<T extends AutoresponderRule>(
  rules: T[],
  message: { content: string; channelId: string; parentChannelId?: string; roleIds: string[] },
): T | undefined {
  return [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority)
    .find((r) => isInScope(r, message.channelId, message.roleIds, message.parentChannelId) && matchesTrigger(message.content, r.trigger, r.matchMode, r.caseSensitive));
}

export function pickResponse(responses: string[], random: () => number = Math.random): string | undefined {
  if (responses.length === 0) return undefined;
  return responses[Math.floor(random() * responses.length) % responses.length];
}

const snowflake = z.string().regex(/^\d{17,20}$/);

export const autoresponderInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    enabled: z.boolean().default(true),
    trigger: z.string().min(1).max(REGEX_MAX_PATTERN),
    matchMode: z.enum(['exact', 'starts_with', 'ends_with', 'contains', 'regex']).default('contains'),
    caseSensitive: z.boolean().default(false),
    responseType: z.enum(['text', 'embed', 'random', 'actions_only']).default('text'),
    responses: z.array(z.string().min(1).max(2000)).max(20).default([]),
    embedId: z.string().max(40).optional().nullable(),
    allowedChannelIds: z.array(snowflake).max(100).default([]),
    blockedChannelIds: z.array(snowflake).max(100).default([]),
    allowedRoleIds: z.array(snowflake).max(100).default([]),
    blockedRoleIds: z.array(snowflake).max(100).default([]),
    cooldownSeconds: z.number().int().min(0).max(86400).default(0),
    deleteTrigger: z.boolean().default(false),
    deleteResponseAfterSeconds: z.number().int().min(1).max(3600).optional().nullable(),
    logUses: z.boolean().default(false),
    priority: z.number().int().min(-100).max(100).default(0),
    actions: z.array(actionSpecSchema).max(10).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.matchMode === 'regex') {
      const check = validateRegex(v.trigger);
      if (!check.ok) ctx.addIssue({ code: 'custom', path: ['trigger'], message: check.reason });
    }
    if ((v.responseType === 'text' || v.responseType === 'random') && v.responses.length === 0)
      ctx.addIssue({ code: 'custom', path: ['responses'], message: 'Add at least one response.' });
    if (v.responseType === 'embed' && !v.embedId) ctx.addIssue({ code: 'custom', path: ['embedId'], message: 'Choose a saved embed.' });
    if (v.responseType === 'actions_only' && v.actions.length === 0)
      ctx.addIssue({ code: 'custom', path: ['actions'], message: 'Add at least one action.' });
  });

export type AutoresponderInput = z.infer<typeof autoresponderInputSchema>;
