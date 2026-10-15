/** Collects snowflake-looking values from nested input by key name so they can be checked against the real guild. */
export function collectIds(value: unknown, key = '', out: { channels: string[]; roles: string[] } = { channels: [], roles: [] }) {
  if (typeof value === 'string' && /^\d{17,20}$/.test(value)) {
    if (/role/i.test(key)) out.roles.push(value);
    else if (/channel|category/i.test(key)) out.channels.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectIds(v, key, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectIds(v, k === 'id' ? key : k, out);
  }
  return out;
}

/** Role IDs that the bot will assign (as opposed to roles only used for permission checks). */
export function assignableRoleIdsFromActions(actions: { type: string; roleId?: string }[]): string[] {
  return actions.filter((a) => a.type === 'add_role' || a.type === 'remove_role' || a.type === 'toggle_role').map((a) => a.roleId!).filter(Boolean);
}
