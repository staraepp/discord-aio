import { z } from 'zod';
import type { RenderedMessage } from '@aio/discord-ui';
import { renderTemplate, type VariableContext } from '@aio/variables';

/**
 * Shared action engine for autoresponders, saved-embed buttons and future
 * automations. No economy actions. Every role action is hierarchy-checked
 * through the executor port before running.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const actionSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_text'), text: z.string().min(1).max(2000), channelId: snowflake.optional() }),
  z.object({ type: z.literal('send_embed'), embedId: z.string().min(1).max(40), channelId: snowflake.optional() }),
  z.object({ type: z.literal('dm_user'), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('add_role'), roleId: snowflake }),
  z.object({ type: z.literal('remove_role'), roleId: snowflake }),
  z.object({ type: z.literal('toggle_role'), roleId: snowflake }),
  z.object({ type: z.literal('delete_trigger') }),
  z.object({ type: z.literal('delete_response_after'), seconds: z.number().int().min(1).max(3600) }),
  z.object({ type: z.literal('react'), emoji: z.string().min(1).max(64) }),
  z.object({ type: z.literal('log'), text: z.string().min(1).max(1000), channelId: snowflake.optional() }),
]);

export type ActionSpec = z.infer<typeof actionSpecSchema>;
export type ActionType = ActionSpec['type'];

export const ACTION_LABELS: Record<ActionType, string> = {
  send_text: 'Send text',
  send_embed: 'Send saved embed',
  dm_user: 'DM the user',
  add_role: 'Add role',
  remove_role: 'Remove role',
  toggle_role: 'Toggle role',
  delete_trigger: 'Delete triggering message',
  delete_response_after: 'Delete bot response after N seconds',
  react: 'React to message',
  log: 'Write a log event',
};

/** Ports implemented by the bot. Kept minimal so the engine is testable with fakes. */
export interface ActionExecutor {
  userId: string;
  memberHasRole(roleId: string): boolean;
  /** Hierarchy/permission check before any role mutation. */
  checkRole(roleId: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  addRole(roleId: string, reason: string): Promise<void>;
  removeRole(roleId: string, reason: string): Promise<void>;
  /** Sends to channelId or, if undefined, to the triggering channel. Returns the sent message ID. */
  send(message: RenderedMessage, channelId?: string): Promise<string | undefined>;
  sendSavedEmbed(embedId: string, channelId?: string): Promise<string | undefined>;
  dm(message: RenderedMessage): Promise<boolean>;
  deleteTrigger(): Promise<void>;
  deleteMessageLater(messageId: string, seconds: number): void;
  react(emoji: string): Promise<void>;
  log(text: string, channelId?: string): Promise<void>;
  /** Whether channelId belongs to the configured guild and the bot may send there. */
  canSendTo(channelId: string): boolean;
}

export interface ActionResult {
  type: ActionType;
  ok: boolean;
  detail?: string;
}

function textMessage(text: string, ctx: VariableContext): RenderedMessage {
  const r = renderTemplate(text, ctx);
  return { content: r.text.slice(0, 2000), embeds: [], components: [], allowed_mentions: { parse: [], users: r.mentionUserIds, roles: [] } };
}

export async function runActions(actions: ActionSpec[], exec: ActionExecutor, ctx: VariableContext, reason: string): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const sentMessageIds: string[] = [];
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'send_text': {
          if (action.channelId && !exec.canSendTo(action.channelId)) {
            results.push({ type: action.type, ok: false, detail: 'Channel not available' });
            break;
          }
          const id = await exec.send(textMessage(action.text, ctx), action.channelId);
          if (id) sentMessageIds.push(id);
          results.push({ type: action.type, ok: true });
          break;
        }
        case 'send_embed': {
          if (action.channelId && !exec.canSendTo(action.channelId)) {
            results.push({ type: action.type, ok: false, detail: 'Channel not available' });
            break;
          }
          const id = await exec.sendSavedEmbed(action.embedId, action.channelId);
          if (id) sentMessageIds.push(id);
          results.push({ type: action.type, ok: Boolean(id), detail: id ? undefined : 'Saved embed not found' });
          break;
        }
        case 'dm_user': {
          const ok = await exec.dm(textMessage(action.text, ctx));
          results.push({ type: action.type, ok, detail: ok ? undefined : 'User has DMs closed' });
          break;
        }
        case 'add_role':
        case 'remove_role':
        case 'toggle_role': {
          const check = await exec.checkRole(action.roleId);
          if (!check.ok) {
            results.push({ type: action.type, ok: false, detail: check.reason });
            break;
          }
          const has = exec.memberHasRole(action.roleId);
          const add = action.type === 'add_role' || (action.type === 'toggle_role' && !has);
          if (add && !has) await exec.addRole(action.roleId, reason);
          if (!add && has) await exec.removeRole(action.roleId, reason);
          results.push({ type: action.type, ok: true, detail: add ? 'added' : 'removed' });
          break;
        }
        case 'delete_trigger':
          await exec.deleteTrigger();
          results.push({ type: action.type, ok: true });
          break;
        case 'delete_response_after':
          for (const id of sentMessageIds) exec.deleteMessageLater(id, action.seconds);
          results.push({ type: action.type, ok: true, detail: `${sentMessageIds.length} message(s)` });
          break;
        case 'react':
          await exec.react(action.emoji);
          results.push({ type: action.type, ok: true });
          break;
        case 'log':
          await exec.log(renderTemplate(action.text, ctx).text, action.channelId);
          results.push({ type: action.type, ok: true });
          break;
      }
    } catch (err) {
      results.push({ type: action.type, ok: false, detail: err instanceof Error ? err.message : 'Action failed' });
    }
  }
  return results;
}
