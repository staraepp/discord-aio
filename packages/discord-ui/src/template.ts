import { z } from 'zod';

/**
 * The single reusable Discord message template model used by every module
 * (welcome/goodbye, autoresponders, ticket/verification/temp-VC/role panels,
 * music panel, level-up, honeypot, saved embeds).
 */

export const LIMITS = {
  content: 2000,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  embedTotal: 6000,
  embeds: 10,
  rows: 5,
  buttonsPerRow: 5,
  selectOptions: 25,
  label: 80,
  customId: 100,
  placeholder: 150,
  optionDescription: 100,
} as const;

export function isSafeUrl(value: string, opts: { allowTemplate?: boolean } = {}): boolean {
  if (opts.allowTemplate && /^\{[a-z_.]+\}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

const templUrl = z
  .string()
  .max(2048)
  .refine((v) => isSafeUrl(v, { allowTemplate: true }), 'Must be an http(s) URL or a URL variable such as {user.avatar}');

const optionalText = (max: number) => z.string().max(max).optional();

export const embedFieldSchema = z.object({
  name: z.string().min(1).max(LIMITS.fieldName),
  value: z.string().min(1).max(LIMITS.fieldValue),
  inline: z.boolean().default(false),
});

export const embedTemplateSchema = z.object({
  title: optionalText(LIMITS.title),
  url: templUrl.optional(),
  description: optionalText(LIMITS.description),
  color: z.number().int().min(0).max(0xffffff).optional(),
  author: z
    .object({ name: z.string().min(1).max(LIMITS.author), iconUrl: templUrl.optional(), url: templUrl.optional() })
    .optional(),
  footer: z.object({ text: z.string().min(1).max(LIMITS.footer), iconUrl: templUrl.optional() }).optional(),
  thumbnailUrl: templUrl.optional(),
  imageUrl: templUrl.optional(),
  timestamp: z.boolean().default(false),
  fields: z.array(embedFieldSchema).max(LIMITS.fields).default([]),
});

export const buttonStyleSchema = z.enum(['primary', 'secondary', 'success', 'danger', 'link']);

/** Emoji: unicode character(s) or a custom emoji reference `<:name:id>` / `<a:name:id>`. */
export const emojiSchema = z
  .string()
  .max(64)
  .refine((v) => /^<a?:\w{2,32}:\d{17,20}>$/.test(v) || [...v].length <= 8, 'Use a unicode emoji or <:name:id>');

export const templateButtonSchema = z
  .object({
    type: z.literal('button'),
    key: z.string().min(1).max(40).regex(/^[\w-]+$/),
    style: buttonStyleSchema.default('secondary'),
    label: z.string().max(LIMITS.label).optional(),
    emoji: emojiSchema.optional(),
    url: templUrl.optional(),
    disabled: z.boolean().default(false),
  })
  .refine((b) => b.label || b.emoji, 'Buttons need a label or an emoji')
  .refine((b) => (b.style === 'link') === Boolean(b.url), 'Link buttons need a URL; other buttons must not have one');

export const templateSelectOptionSchema = z.object({
  label: z.string().min(1).max(LIMITS.label),
  value: z.string().min(1).max(100),
  description: z.string().max(LIMITS.optionDescription).optional(),
  emoji: emojiSchema.optional(),
});

export const templateSelectSchema = z
  .object({
    type: z.literal('select'),
    key: z.string().min(1).max(40).regex(/^[\w-]+$/),
    placeholder: z.string().max(LIMITS.placeholder).optional(),
    minValues: z.number().int().min(0).max(25).default(1),
    maxValues: z.number().int().min(1).max(25).default(1),
    options: z.array(templateSelectOptionSchema).min(1).max(LIMITS.selectOptions),
  })
  .refine((s) => s.minValues <= s.maxValues && s.maxValues <= s.options.length, 'Min/max selections must fit the options');

export const templateComponentSchema = z.union([templateButtonSchema, templateSelectSchema]);

export const componentRowSchema = z
  .array(templateComponentSchema)
  .min(1)
  .max(LIMITS.buttonsPerRow)
  .refine((row) => !row.some((c) => c.type === 'select') || row.length === 1, 'A select menu must be alone in its row');

export const messageTemplateSchema = z
  .object({
    content: optionalText(LIMITS.content),
    embeds: z.array(embedTemplateSchema).max(LIMITS.embeds).default([]),
    components: z.array(componentRowSchema).max(LIMITS.rows).default([]),
  })
  .refine((t) => Boolean(t.content?.trim()) || t.embeds.length > 0, 'A message needs content or at least one embed')
  .refine((t) => t.embeds.every((e) => embedTextLength(e) <= LIMITS.embedTotal), 'Embed text exceeds 6000 characters')
  .refine((t) => {
    const keys = t.components.flat().map((c) => c.key);
    return new Set(keys).size === keys.length;
  }, 'Component keys must be unique');

export type EmbedTemplate = z.infer<typeof embedTemplateSchema>;
export type TemplateButton = z.infer<typeof templateButtonSchema>;
export type TemplateSelect = z.infer<typeof templateSelectSchema>;
export type TemplateComponent = z.infer<typeof templateComponentSchema>;
export type MessageTemplate = z.infer<typeof messageTemplateSchema>;

export function embedTextLength(e: EmbedTemplate): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.author?.name.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

export function parseColor(input: string): number | undefined {
  const hex = input.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  return parseInt(hex, 16);
}

export function colorToHex(color: number | undefined): string {
  return `#${(color ?? 0x5865f2).toString(16).padStart(6, '0')}`;
}

export function emptyTemplate(): MessageTemplate {
  return { content: undefined, embeds: [{ title: 'New embed', description: 'Edit me', color: 0x5865f2, timestamp: false, fields: [] }], components: [] };
}
