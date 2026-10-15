import { renderTemplate, type VariableContext } from '@aio/variables';
import { isSafeUrl, LIMITS, type EmbedTemplate, type MessageTemplate, type TemplateComponent } from './template';

/**
 * Converts a MessageTemplate + variable context into a Discord REST/discord.js
 * compatible JSON payload. Output is plain JSON so both the bot (discord.js)
 * and the web (REST) can send it, and the dashboard can preview it.
 */

export interface RenderedEmoji {
  id?: string;
  name?: string;
  animated?: boolean;
}

export interface RenderedEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  timestamp?: string;
  author?: { name: string; icon_url?: string; url?: string };
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface RenderedButton {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  label?: string;
  emoji?: RenderedEmoji;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

export interface RenderedSelect {
  type: 3;
  custom_id: string;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options: { label: string; value: string; description?: string; emoji?: RenderedEmoji; default?: boolean }[];
}

export interface RenderedRow {
  type: 1;
  components: (RenderedButton | RenderedSelect)[];
}

export interface RenderedMessage {
  content?: string;
  embeds: RenderedEmbed[];
  components: RenderedRow[];
  allowed_mentions: { parse: never[]; users: string[]; roles: string[] };
}

export interface RenderMessageOptions {
  preview?: boolean;
  /** Produces the custom_id for non-link components. */
  customIdFor?: (component: TemplateComponent) => string;
  /** Additional role IDs this message is explicitly allowed to ping (e.g. staff alert role). */
  allowRoleMentions?: string[];
  now?: Date;
}

const STYLE: Record<string, RenderedButton['style']> = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };

export function parseEmoji(input: string | undefined): RenderedEmoji | undefined {
  if (!input) return undefined;
  const custom = /^<(a?):(\w{2,32}):(\d{17,20})>$/.exec(input);
  if (custom) return { animated: custom[1] === 'a', name: custom[2], id: custom[3] };
  return { name: input };
}

function clamp(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function renderMessageTemplate(
  template: MessageTemplate,
  ctx: VariableContext,
  opts: RenderMessageOptions = {},
): RenderedMessage {
  const mentions = new Set<string>();
  const text = (value: string | undefined, max: number): string | undefined => {
    if (value === undefined) return undefined;
    const r = renderTemplate(value, ctx, { preview: opts.preview });
    r.mentionUserIds.forEach((id) => mentions.add(id));
    return clamp(r.text, max);
  };
  const url = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    const rendered = renderTemplate(value, ctx).text.trim();
    return isSafeUrl(rendered) ? rendered : undefined;
  };

  const embeds = template.embeds.map((e: EmbedTemplate): RenderedEmbed => {
    const out: RenderedEmbed = {};
    const title = text(e.title, LIMITS.title);
    if (title) out.title = title;
    const u = url(e.url);
    if (u) out.url = u;
    const description = text(e.description, LIMITS.description);
    if (description) out.description = description;
    if (e.color !== undefined) out.color = e.color;
    if (e.timestamp) out.timestamp = (opts.now ?? ctx.now ?? new Date()).toISOString();
    if (e.author) {
      const name = text(e.author.name, LIMITS.author);
      if (name) out.author = { name, icon_url: url(e.author.iconUrl), url: url(e.author.url) };
    }
    if (e.footer) {
      const ftext = text(e.footer.text, LIMITS.footer);
      if (ftext) out.footer = { text: ftext, icon_url: url(e.footer.iconUrl) };
    }
    const thumb = url(e.thumbnailUrl);
    if (thumb) out.thumbnail = { url: thumb };
    const image = url(e.imageUrl);
    if (image) out.image = { url: image };
    const fields = e.fields
      .map((f) => ({ name: text(f.name, LIMITS.fieldName), value: text(f.value, LIMITS.fieldValue), inline: f.inline }))
      .filter((f): f is { name: string; value: string; inline: boolean } => Boolean(f.name && f.value));
    if (fields.length) out.fields = fields;
    return out;
  });

  const components: RenderedRow[] = template.components.map((row) => ({
    type: 1,
    components: row.map((c): RenderedButton | RenderedSelect => {
      if (c.type === 'button') {
        const base: RenderedButton = {
          type: 2,
          style: STYLE[c.style] ?? 2,
          label: text(c.label, LIMITS.label),
          emoji: parseEmoji(c.emoji),
          disabled: c.disabled || undefined,
        };
        if (c.style === 'link') {
          const link = url(c.url);
          return link ? { ...base, url: link } : { ...base, style: 2, disabled: true, custom_id: `noop:${c.key}` };
        }
        return { ...base, custom_id: (opts.customIdFor?.(c) ?? `noop:${c.key}`).slice(0, LIMITS.customId) };
      }
      return {
        type: 3,
        custom_id: (opts.customIdFor?.(c) ?? `noop:${c.key}`).slice(0, LIMITS.customId),
        placeholder: text(c.placeholder, LIMITS.placeholder),
        min_values: c.minValues,
        max_values: Math.min(c.maxValues, c.options.length),
        options: c.options.map((o) => ({
          label: text(o.label, LIMITS.label) ?? o.value,
          value: o.value,
          description: text(o.description, LIMITS.optionDescription),
          emoji: parseEmoji(o.emoji),
        })),
      };
    }),
  }));

  return {
    content: text(template.content, LIMITS.content),
    embeds,
    components,
    allowed_mentions: { parse: [], users: [...mentions], roles: opts.allowRoleMentions ?? [] },
  };
}

/** Build a simple one-embed message quickly (used for system notices). */
export function simpleEmbed(params: { title?: string; description: string; color?: number; footer?: string }): RenderedMessage {
  return {
    embeds: [
      {
        title: params.title,
        description: params.description.slice(0, LIMITS.description),
        color: params.color ?? 0x5865f2,
        footer: params.footer ? { text: params.footer } : undefined,
      },
    ],
    components: [],
    allowed_mentions: { parse: [], users: [], roles: [] },
  };
}

export const COLORS = {
  brand: 0x6d5dfc,
  success: 0x2fb87a,
  warning: 0xf0b232,
  danger: 0xe5484d,
  info: 0x3b82f6,
  muted: 0x6b7280,
} as const;
