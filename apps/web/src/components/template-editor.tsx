'use client';

import { useState } from 'react';
import type { EmbedTemplate, MessageTemplate, TemplateButton, TemplateComponent, TemplateSelect } from '@aio/discord-ui';
import { VARIABLES } from '@aio/variables';
import { ArrowDown, ArrowUp, Braces, Plus, Trash2 } from 'lucide-react';
import { Advanced, Button, Field, Select, TextArea, TextInput, Toggle, cx } from './ui';
import { TemplatePreview } from './discord-preview';

export const EMPTY_TEMPLATE: MessageTemplate = { content: '', embeds: [{ title: 'Title', description: 'Write something here.', color: 0x6d5dfc, timestamp: false, fields: [] }], components: [] };

function hex(n: number | undefined): string {
  return `#${(n ?? 0x6d5dfc).toString(16).padStart(6, '0')}`;
}

function opt(v: string): string | undefined {
  return v.trim() === '' ? undefined : v;
}

export function VariableHelp({ extra = [] }: { extra?: { name: string; description: string }[] }) {
  return (
    <Advanced title="Available variables">
      <p className="text-xs text-muted">Only these variables are replaced. {'{user}'} and {'{staff}'} ping; everything else is plain text and never pings.</p>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {[...VARIABLES, ...extra].map((v) => (
          <li key={v.name} className="flex gap-2">
            <code className="rounded bg-bg px-1 text-accent">{`{${v.name}}`}</code>
            <span className="text-muted">{v.description}</span>
          </li>
        ))}
      </ul>
    </Advanced>
  );
}

function EmbedEditor({ embed, onChange, onRemove, index }: { embed: EmbedTemplate; onChange: (e: EmbedTemplate) => void; onRemove: () => void; index: number }) {
  const set = (patch: Partial<EmbedTemplate>) => onChange({ ...embed, ...patch });
  return (
    <fieldset className="space-y-4 rounded-xl border border-line p-4">
      <legend className="px-1 text-sm font-medium">Embed {index + 1}</legend>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <TextInput label="Title" value={embed.title ?? ''} onChange={(v) => set({ title: opt(v) })} maxLength={256} />
        <Field label="Color">
          <input type="color" aria-label="Embed color" value={hex(embed.color)} onChange={(e) => set({ color: parseInt(e.target.value.slice(1), 16) })} className="h-10 w-16 cursor-pointer rounded-lg border border-line bg-bg" />
        </Field>
      </div>
      <TextArea label="Description" value={embed.description ?? ''} onChange={(v) => set({ description: opt(v) })} rows={5} maxLength={4096} />
      <div className="space-y-2">
        <p className="text-sm font-medium">Fields</p>
        {embed.fields.map((f, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_2fr_auto_auto]">
            <TextInput label="Name" value={f.name} onChange={(v) => set({ fields: embed.fields.map((x, j) => (j === i ? { ...x, name: v } : x)) })} maxLength={256} />
            <TextInput label="Value" value={f.value} onChange={(v) => set({ fields: embed.fields.map((x, j) => (j === i ? { ...x, value: v } : x)) })} maxLength={1024} />
            <div className="self-end pb-1">
              <Toggle label="Inline" checked={f.inline} onChange={(v) => set({ fields: embed.fields.map((x, j) => (j === i ? { ...x, inline: v } : x)) })} />
            </div>
            <Button variant="ghost" className="self-end" aria-label={`Remove field ${i + 1}`} onClick={() => set({ fields: embed.fields.filter((_, j) => j !== i) })}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button size="sm" disabled={embed.fields.length >= 25} onClick={() => set({ fields: [...embed.fields, { name: 'Field', value: 'Value', inline: false }] })}>
          <Plus className="size-4" /> Add field
        </Button>
      </div>
      <Advanced title="Images, author, footer and link">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Thumbnail URL" value={embed.thumbnailUrl ?? ''} onChange={(v) => set({ thumbnailUrl: opt(v) })} placeholder="https://… or {user.avatar}" />
          <TextInput label="Image URL" value={embed.imageUrl ?? ''} onChange={(v) => set({ imageUrl: opt(v) })} placeholder="https://…" />
          <TextInput label="Title link" value={embed.url ?? ''} onChange={(v) => set({ url: opt(v) })} placeholder="https://…" />
          <TextInput label="Author name" value={embed.author?.name ?? ''} onChange={(v) => set({ author: opt(v) ? { ...embed.author, name: v } : undefined })} />
          <TextInput label="Author icon URL" value={embed.author?.iconUrl ?? ''} onChange={(v) => embed.author && set({ author: { ...embed.author, iconUrl: opt(v) } })} disabled={!embed.author} />
          <TextInput label="Footer text" value={embed.footer?.text ?? ''} onChange={(v) => set({ footer: opt(v) ? { ...embed.footer, text: v } : undefined })} />
          <TextInput label="Footer icon URL" value={embed.footer?.iconUrl ?? ''} onChange={(v) => embed.footer && set({ footer: { ...embed.footer, iconUrl: opt(v) } })} disabled={!embed.footer} />
          <Toggle label="Show timestamp" checked={embed.timestamp} onChange={(v) => set({ timestamp: v })} />
        </div>
      </Advanced>
      <Button variant="danger" size="sm" onClick={onRemove}>
        <Trash2 className="size-4" /> Remove embed
      </Button>
    </fieldset>
  );
}

let keySeq = 0;
function newKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${keySeq}`;
}

function ComponentEditor({ c, onChange, onRemove }: { c: TemplateComponent; onChange: (c: TemplateComponent) => void; onRemove: () => void }) {
  if (c.type === 'button') {
    const b = c as TemplateButton;
    return (
      <div className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-4">
        <TextInput label="Label" value={b.label ?? ''} onChange={(v) => onChange({ ...b, label: opt(v) })} maxLength={80} />
        <TextInput label="Emoji" value={b.emoji ?? ''} onChange={(v) => onChange({ ...b, emoji: opt(v) })} placeholder="😭 or <:name:id>" />
        <Select
          label="Style"
          value={b.style}
          onChange={(v) => onChange({ ...b, style: v, url: v === 'link' ? (b.url ?? 'https://example.com') : undefined })}
          options={[
            { value: 'primary', label: 'Blurple' },
            { value: 'secondary', label: 'Grey' },
            { value: 'success', label: 'Green' },
            { value: 'danger', label: 'Red' },
            { value: 'link', label: 'Link' },
          ]}
        />
        {b.style === 'link' ? (
          <TextInput label="URL" value={b.url ?? ''} onChange={(v) => onChange({ ...b, url: v })} />
        ) : (
          <Field label="Key">
            <code className="flex h-10 items-center rounded-lg border border-line bg-bg px-3 text-xs text-muted">{b.key}</code>
          </Field>
        )}
        <Button variant="ghost" size="sm" onClick={onRemove} className="sm:col-span-4 sm:justify-self-end">
          <Trash2 className="size-4" /> Remove button
        </Button>
      </div>
    );
  }
  const s = c as TemplateSelect;
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <TextInput label="Placeholder" value={s.placeholder ?? ''} onChange={(v) => onChange({ ...s, placeholder: opt(v) })} />
      {s.options.map((o, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <TextInput label="Option label" value={o.label} onChange={(v) => onChange({ ...s, options: s.options.map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
          <TextInput label="Value" value={o.value} onChange={(v) => onChange({ ...s, options: s.options.map((x, j) => (j === i ? { ...x, value: v } : x)) })} />
          <Button variant="ghost" className="self-end" aria-label="Remove option" onClick={() => onChange({ ...s, options: s.options.filter((_, j) => j !== i), maxValues: Math.min(s.maxValues, Math.max(1, s.options.length - 1)) })}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button size="sm" disabled={s.options.length >= 25} onClick={() => onChange({ ...s, options: [...s.options, { label: `Option ${s.options.length + 1}`, value: `option_${s.options.length + 1}` }] })}>
          <Plus className="size-4" /> Add option
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="size-4" /> Remove menu
        </Button>
      </div>
    </div>
  );
}

/**
 * The one reusable message editor. `allowComponents` enables buttons/selects
 * (only where the module can act on them, e.g. saved embeds with actions).
 */
export function TemplateEditor({
  value,
  onChange,
  allowComponents = false,
  previewCtx,
  extraVariables,
  maxEmbeds = 10,
}: {
  value: MessageTemplate;
  onChange: (t: MessageTemplate) => void;
  allowComponents?: boolean;
  previewCtx?: Parameters<typeof TemplatePreview>[0]['ctx'];
  extraVariables?: { name: string; description: string }[];
  maxEmbeds?: number;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const set = (patch: Partial<MessageTemplate>) => onChange({ ...value, ...patch });
  const editor = (
    <div className="space-y-4">
      <TextArea label="Message content" hint="Plain text above the embed. Optional if you add an embed." value={value.content ?? ''} onChange={(v) => set({ content: opt(v) })} rows={3} maxLength={2000} />
      {value.embeds.map((e, i) => (
        <div key={i} className="relative">
          {value.embeds.length > 1 && (
            <div className="absolute top-2 right-2 z-10 flex gap-1">
              <Button size="sm" variant="ghost" aria-label="Move embed up" disabled={i === 0} onClick={() => set({ embeds: swap(value.embeds, i, i - 1) })}>
                <ArrowUp className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Move embed down" disabled={i === value.embeds.length - 1} onClick={() => set({ embeds: swap(value.embeds, i, i + 1) })}>
                <ArrowDown className="size-4" />
              </Button>
            </div>
          )}
          <EmbedEditor index={i} embed={e} onChange={(ne) => set({ embeds: value.embeds.map((x, j) => (j === i ? ne : x)) })} onRemove={() => set({ embeds: value.embeds.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <Button size="sm" disabled={value.embeds.length >= maxEmbeds} onClick={() => set({ embeds: [...value.embeds, { description: 'New embed', timestamp: false, fields: [], color: 0x6d5dfc }] })}>
        <Plus className="size-4" /> Add embed
      </Button>
      {allowComponents && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Buttons and menus</p>
          {value.components.map((row, ri) => (
            <fieldset key={ri} className="space-y-2 rounded-xl border border-line p-3">
              <legend className="px-1 text-xs text-muted">Row {ri + 1}</legend>
              {row.map((c, ci) => (
                <ComponentEditor
                  key={c.key}
                  c={c}
                  onChange={(nc) => set({ components: value.components.map((r, j) => (j === ri ? r.map((x, k) => (k === ci ? nc : x)) : r)) })}
                  onRemove={() => set({ components: value.components.map((r, j) => (j === ri ? r.filter((_, k) => k !== ci) : r)).filter((r) => r.length > 0) })}
                />
              ))}
              {row[0]?.type !== 'select' && row.length < 5 && (
                <Button size="sm" onClick={() => set({ components: value.components.map((r, j) => (j === ri ? [...r, { type: 'button', key: newKey('b'), style: 'secondary', label: 'Button', disabled: false }] : r)) })}>
                  <Plus className="size-4" /> Add button to row
                </Button>
              )}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={value.components.length >= 5} onClick={() => set({ components: [...value.components, [{ type: 'button', key: newKey('b'), style: 'primary', label: 'Button', disabled: false }]] })}>
              <Plus className="size-4" /> Button row
            </Button>
            <Button size="sm" disabled={value.components.length >= 5} onClick={() => set({ components: [...value.components, [{ type: 'select', key: newKey('s'), placeholder: 'Choose…', minValues: 1, maxValues: 1, options: [{ label: 'Option 1', value: 'option_1' }] }]] })}>
              <Plus className="size-4" /> Select menu
            </Button>
          </div>
        </div>
      )}
      <VariableHelp extra={extraVariables} />
    </div>
  );
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="xl:hidden">
        <div role="tablist" className="mb-3 flex gap-1">
          {(['edit', 'preview'] as const).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-lg px-3 py-1.5 text-sm capitalize', tab === t ? 'bg-panel-2 text-text' : 'text-muted')}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className={cx(tab === 'preview' && 'hidden xl:block')}>{editor}</div>
      <div className={cx('xl:sticky xl:top-4 xl:self-start', tab === 'edit' && 'hidden xl:block')}>
        <p className="mb-2 flex items-center gap-1 text-xs text-muted">
          <Braces className="size-3" aria-hidden /> Live preview with sample values
        </p>
        <TemplatePreview template={value} ctx={previewCtx} />
      </div>
    </div>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const out = [...arr];
  [out[a], out[b]] = [out[b]!, out[a]!];
  return out;
}
