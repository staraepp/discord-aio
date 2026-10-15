import { z } from 'zod';
import { messageTemplateSchema } from '@aio/discord-ui';

/** Role panel selection rules shared by buttons, select menus and reactions. */

export interface PanelRules {
  exclusive: boolean;
  maxRoles: number | null;
  requiredRoleIds: string[];
  blockedRoleIds: string[];
}

export interface PanelOption {
  roleId: string;
  behavior: 'toggle' | 'add' | 'remove';
}

export type RoleChange = { ok: true; add: string[]; remove: string[]; message: string } | { ok: false; message: string };

function gate(rules: PanelRules, memberRoleIds: string[]): string | null {
  if (rules.blockedRoleIds.some((r) => memberRoleIds.includes(r))) return 'You have a role that blocks you from using this panel.';
  if (rules.requiredRoleIds.length > 0 && !rules.requiredRoleIds.some((r) => memberRoleIds.includes(r))) return 'You need a specific role before you can use this panel.';
  return null;
}

/** Button / reaction click on a single option. */
export function applyOptionClick(params: { rules: PanelRules; options: PanelOption[]; clicked: PanelOption; memberRoleIds: string[]; reactionRemoved?: boolean }): RoleChange {
  const blocked = gate(params.rules, params.memberRoleIds);
  if (blocked) return { ok: false, message: blocked };
  const panelRoles = params.options.map((o) => o.roleId);
  const held = panelRoles.filter((r) => params.memberRoleIds.includes(r));
  const has = params.memberRoleIds.includes(params.clicked.roleId);

  let wantAdd: boolean;
  if (params.reactionRemoved !== undefined) wantAdd = !params.reactionRemoved && params.clicked.behavior !== 'remove';
  else if (params.clicked.behavior === 'add') wantAdd = true;
  else if (params.clicked.behavior === 'remove') wantAdd = false;
  else wantAdd = !has;

  if (!wantAdd) {
    if (!has) return { ok: true, add: [], remove: [], message: "You don't have that role." };
    return { ok: true, add: [], remove: [params.clicked.roleId], message: `Removed <@&${params.clicked.roleId}>.` };
  }
  if (has) return { ok: true, add: [], remove: [], message: 'You already have that role.' };
  if (params.rules.exclusive) {
    const remove = held.filter((r) => r !== params.clicked.roleId);
    return { ok: true, add: [params.clicked.roleId], remove, message: `Switched to <@&${params.clicked.roleId}>.` };
  }
  if (params.rules.maxRoles !== null && held.length >= params.rules.maxRoles) {
    return { ok: false, message: `You can pick at most ${params.rules.maxRoles} role${params.rules.maxRoles === 1 ? '' : 's'} from this panel. Remove one first.` };
  }
  return { ok: true, add: [params.clicked.roleId], remove: [], message: `Added <@&${params.clicked.roleId}>.` };
}

/** Select menu submission: the selection becomes the member's full set for this panel. */
export function applySelection(params: { rules: PanelRules; options: PanelOption[]; selectedRoleIds: string[]; memberRoleIds: string[] }): RoleChange {
  const blocked = gate(params.rules, params.memberRoleIds);
  if (blocked) return { ok: false, message: blocked };
  const panelRoles = new Set(params.options.map((o) => o.roleId));
  const selected = [...new Set(params.selectedRoleIds)].filter((r) => panelRoles.has(r));
  const limit = params.rules.exclusive ? 1 : params.rules.maxRoles;
  if (limit !== null && selected.length > limit) return { ok: false, message: `You can pick at most ${limit} role${limit === 1 ? '' : 's'}.` };
  const held = [...panelRoles].filter((r) => params.memberRoleIds.includes(r));
  const add = selected.filter((r) => !held.includes(r));
  const remove = held.filter((r) => !selected.includes(r));
  return { ok: true, add, remove, message: add.length || remove.length ? 'Your roles were updated.' : 'No changes.' };
}

const snowflake = z.string().regex(/^\d{17,20}$/);

export const rolePanelOptionSchema = z.object({
  roleId: snowflake,
  label: z.string().min(1).max(80),
  emoji: z.string().max(64).optional().nullable(),
  description: z.string().max(100).optional().nullable(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('secondary'),
  behavior: z.enum(['toggle', 'add', 'remove']).default('toggle'),
});

export const rolePanelInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    kind: z.enum(['button', 'select', 'reaction']).default('button'),
    template: messageTemplateSchema,
    exclusive: z.boolean().default(false),
    maxRoles: z.number().int().min(1).max(25).optional().nullable(),
    requiredRoleIds: z.array(snowflake).max(20).default([]),
    blockedRoleIds: z.array(snowflake).max(20).default([]),
    logChannelId: snowflake.optional().nullable(),
    placeholder: z.string().max(150).optional().nullable(),
    options: z.array(rolePanelOptionSchema).min(1).max(25),
  })
  .superRefine((p, ctx) => {
    if (p.kind === 'button' && p.options.length > 25) ctx.addIssue({ code: 'custom', path: ['options'], message: 'At most 25 buttons.' });
    if (p.kind === 'reaction' && p.options.some((o) => !o.emoji)) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Reaction panels need an emoji on every option.' });
    if (new Set(p.options.map((o) => o.roleId)).size !== p.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Each role can appear only once.' });
    if (p.template.components.length > 0) ctx.addIssue({ code: 'custom', path: ['template'], message: 'Role panel buttons are generated from the options; remove custom components from the template.' });
  });

export type RolePanelInput = z.infer<typeof rolePanelInputSchema>;
