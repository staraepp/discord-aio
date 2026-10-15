/**
 * Text-prefix commands (`+warn @user being bad`). Every slash command is described by its
 * registration JSON, so this parser reads that JSON instead of each command defining a
 * second syntax. Output is the same option values the slash handler would receive.
 */

export const OPT = { SUB: 1, GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 } as const;

export interface CmdOption {
  type: number;
  name: string;
  description?: string;
  required?: boolean;
  choices?: { name: string; value: string | number }[];
  options?: CmdOption[];
  autocomplete?: boolean;
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
}

export interface CmdSpec {
  name: string;
  description?: string;
  options?: CmdOption[];
}

/** Resolves a token (mention, ID or name) to a snowflake, or null. */
export interface EntityResolver {
  user(token: string): string | null;
  channel(token: string): string | null;
  role(token: string): string | null;
}

export interface ParsedValue {
  type: number;
  value: string | number | boolean;
}

export type ParseResult =
  | { ok: true; group?: string; sub?: string; values: Record<string, ParsedValue>; options: CmdOption[] }
  | { ok: false; error: string; usage: string };

interface Token {
  text: string;
  start: number;
  end: number;
  quoted: boolean;
}

const QUOTES: Record<string, string> = { '"': '"', '“': '”', '„': '“' };

/** Whitespace split that keeps "quoted phrases" together and remembers positions in the input. */
export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;
    const close = QUOTES[input[i]!];
    if (close) {
      const endQuote = input.indexOf(close, i + 1);
      if (endQuote > i) {
        out.push({ text: input.slice(i + 1, endQuote), start: i, end: endQuote + 1, quoted: true });
        i = endQuote + 1;
        continue;
      }
    }
    const start = i;
    while (i < input.length && !/\s/.test(input[i]!)) i++;
    out.push({ text: input.slice(start, i), start, end: i, quoted: false });
  }
  return out;
}

const GREEDY_NAMES = ['reason', 'query', 'text', 'question', 'content', 'message', 'name'];
const TRUE = new Set(['true', 'yes', 'y', 'on', '1', 'enable', 'enabled']);
const FALSE = new Set(['false', 'no', 'n', 'off', '0', 'disable', 'disabled']);

const isValueOption = (o: CmdOption) => o.type !== OPT.SUB && o.type !== OPT.GROUP;

function placeholder(o: CmdOption, greedy: boolean): string {
  const label = o.choices?.length && o.choices.length <= 6 ? o.choices.map((c) => c.name).join('|') : `${o.name}${greedy ? '…' : ''}`;
  return o.required ? `<${label}>` : `[${label}]`;
}

function greedyOption(opts: CmdOption[]): CmdOption | undefined {
  const strings = opts.filter((o) => o.type === OPT.STRING && !o.choices?.length);
  return GREEDY_NAMES.map((n) => strings.find((o) => o.name === n)).find(Boolean) ?? strings.at(-1);
}

/** `+warn <member> <reason…> [evidence]`, or the list of subcommands. */
export function usageFor(prefix: string, spec: CmdSpec, path: string[] = [], opts: CmdOption[] = spec.options ?? []): string {
  const head = [prefix + spec.name, ...path].join(' ');
  const nested = opts.filter((o) => o.type === OPT.SUB || o.type === OPT.GROUP);
  if (nested.length) return `${head} <${nested.map((o) => o.name).join('|')}> …`;
  const greedy = greedyOption(opts);
  return [head, ...opts.filter(isValueOption).map((o) => placeholder(o, o === greedy))].join(' ');
}

function parseTyped(o: CmdOption, raw: string, r: EntityResolver): { ok: true; value: string | number | boolean } | { ok: false; error: string } {
  const text = raw.trim();
  switch (o.type) {
    case OPT.INTEGER:
    case OPT.NUMBER: {
      const cleaned = text.replace(/%$/, '').replace(/,/g, '');
      const n = o.type === OPT.INTEGER ? (/^[-+]?\d+$/.test(cleaned) ? Number(cleaned) : NaN) : Number(cleaned);
      if (!Number.isFinite(n) || cleaned === '') return { ok: false, error: `\`${text}\` isn't a ${o.type === OPT.INTEGER ? 'whole number' : 'number'} for ${o.name}.` };
      if (o.min_value !== undefined && n < o.min_value) return { ok: false, error: `${o.name} must be at least ${o.min_value}.` };
      if (o.max_value !== undefined && n > o.max_value) return { ok: false, error: `${o.name} can be at most ${o.max_value}.` };
      return { ok: true, value: n };
    }
    case OPT.BOOLEAN: {
      const v = text.toLowerCase();
      if (TRUE.has(v)) return { ok: true, value: true };
      if (FALSE.has(v)) return { ok: true, value: false };
      return { ok: false, error: `Use yes or no for ${o.name}.` };
    }
    case OPT.USER: {
      const id = r.user(text);
      return id ? { ok: true, value: id } : { ok: false, error: `I couldn't find a member called \`${text}\`. Mention them or use their ID.` };
    }
    case OPT.CHANNEL: {
      const id = r.channel(text);
      return id ? { ok: true, value: id } : { ok: false, error: `I couldn't find the channel \`${text}\`.` };
    }
    case OPT.ROLE: {
      const id = r.role(text);
      return id ? { ok: true, value: id } : { ok: false, error: `I couldn't find the role \`${text}\`.` };
    }
    case OPT.MENTIONABLE: {
      const id = r.user(text) ?? r.role(text);
      return id ? { ok: true, value: id } : { ok: false, error: `I couldn't find \`${text}\`.` };
    }
    case OPT.ATTACHMENT:
      return { ok: false, error: `${o.name} needs a file, use the slash command for this one.` };
    default: {
      if (o.choices?.length) {
        const hit = o.choices.find((c) => c.name.toLowerCase() === text.toLowerCase() || String(c.value).toLowerCase() === text.toLowerCase());
        if (!hit) return { ok: false, error: `${o.name} must be one of: ${o.choices.map((c) => c.name).join(', ')}.` };
        return { ok: true, value: hit.value };
      }
      if (o.max_length !== undefined && text.length > o.max_length) return { ok: false, error: `${o.name} can be at most ${o.max_length} characters.` };
      if (o.min_length !== undefined && text.length < o.min_length) return { ok: false, error: `${o.name} needs at least ${o.min_length} characters.` };
      return { ok: true, value: text };
    }
  }
}

/** Parses everything after `+name`. */
export function parsePrefixArgs(prefix: string, spec: CmdSpec, input: string, resolver: EntityResolver): ParseResult {
  const tokens = tokenize(input);
  let opts = spec.options ?? [];
  const path: string[] = [];
  let cursor = 0;
  const fail = (error: string): ParseResult => ({ ok: false, error, usage: usageFor(prefix, spec, path, opts) });

  let group: string | undefined;
  let sub: string | undefined;
  for (const kind of [OPT.GROUP, OPT.SUB] as const) {
    const choices = opts.filter((o) => o.type === kind);
    if (!choices.length) continue;
    const word = tokens[cursor]?.text.toLowerCase();
    let hit = choices.find((o) => o.name === word);
    if (hit) cursor++;
    // `+queue` or `+queue 2` means the first subcommand when it needs nothing (queue view).
    else if (kind === OPT.SUB && choices[0]!.options?.every((o) => !o.required) !== false) hit = choices[0];
    if (!hit) return fail(word ? `\`${word}\` isn't an option here.` : 'Pick what to do.');
    path.push(hit.name);
    if (kind === OPT.GROUP) group = hit.name;
    else sub = hit.name;
    opts = hit.options ?? [];
  }

  const values: Record<string, ParsedValue> = {};
  const byName = new Map(opts.filter(isValueOption).map((o) => [o.name, o]));

  // Named values (`reason:spam links`, `delete_days:1`) can go anywhere, like in the slash UI.
  const positional: Token[] = [];
  const rest = tokens.slice(cursor);
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k]!;
    const m = !t.quoted && /^([a-z0-9_-]{1,32}):(.*)$/i.exec(t.text);
    const o = m ? byName.get(m[1]!.toLowerCase()) : undefined;
    if (!m || !o) {
      positional.push(t);
      continue;
    }
    let raw = m[2]!;
    if (o.type === OPT.STRING && !o.choices?.length) {
      // A named text value runs until the next `name:` token.
      const isNamed = (x: Token) => {
        const nm = !x.quoted && /^([a-z0-9_-]{1,32}):/i.exec(x.text);
        return Boolean(nm && byName.has(nm[1]!.toLowerCase()));
      };
      let end = t.end;
      while (k + 1 < rest.length && !isNamed(rest[k + 1]!)) end = rest[++k]!.end;
      raw = input.slice(t.start + m[1]!.length + 1, end).trim();
      if (!raw && k + 1 < rest.length) raw = rest[++k]!.text;
    } else if (!raw && k + 1 < rest.length) raw = rest[++k]!.text;
    const parsed = parseTyped(o, raw, resolver);
    if (!parsed.ok) return fail(parsed.error);
    values[o.name] = { type: o.type, value: parsed.value };
  }

  const unfilled = opts.filter((o) => isValueOption(o) && !(o.name in values));
  const greedy = greedyOption(unfilled);
  let p = 0;
  for (let idx = 0; idx < unfilled.length; idx++) {
    const o = unfilled[idx]!;
    if (p >= positional.length) {
      if (o.required) return fail(`Missing ${o.name}.`);
      continue;
    }
    if (o === greedy) {
      // Leave trailing tokens for later typed options, e.g. `+embed send welcome #general`.
      let end = positional.length;
      for (const later of unfilled.slice(idx + 1).reverse()) {
        if (end - 1 <= p || later.type === OPT.STRING) continue;
        if (parseTyped(later, positional[end - 1]!.text, resolver).ok) end--;
      }
      const first = positional[p]!;
      const last = positional[end - 1]!;
      const raw = first === last && first.quoted ? first.text : input.slice(first.start, last.end);
      const parsed = parseTyped(o, raw, resolver);
      if (!parsed.ok) return fail(parsed.error);
      values[o.name] = { type: o.type, value: parsed.value };
      p = end;
      continue;
    }
    const parsed = parseTyped(o, positional[p]!.text, resolver);
    if (parsed.ok) {
      values[o.name] = { type: o.type, value: parsed.value };
      p++;
    } else if (o.required) return fail(parsed.error);
    // Optional and not a match: leave the token for the next option (`+lock spam raid` skips channel).
  }
  return { ok: true, group, sub, values, options: opts };
}

/** Mention/ID/name lookup helpers shared by the bot's resolver. */
export const mentionId = (token: string, kind: 'user' | 'channel' | 'role'): string | null => {
  const re = kind === 'user' ? /^<@!?(\d{17,20})>$/ : kind === 'channel' ? /^<#(\d{17,20})>$/ : /^<@&(\d{17,20})>$/;
  const m = re.exec(token) ?? /^(\d{17,20})$/.exec(token);
  return m ? m[1]! : null;
};
