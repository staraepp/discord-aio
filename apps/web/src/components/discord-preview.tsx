'use client';

import { Fragment, type ReactNode } from 'react';
import { renderMessageTemplate, messageTemplateSchema, type MessageTemplate, type RenderedMessage, type RenderedButton, type RenderedSelect } from '@aio/discord-ui';
import { sampleContext, type VariableContext } from '@aio/variables';
import { ChevronDown } from 'lucide-react';
import { cx } from './ui';

/** Minimal, safe Discord-markdown renderer (React nodes only, never raw HTML). */
export function DiscordMarkdown({ text }: { text: string }) {
  return <span className="discord-md whitespace-pre-wrap break-words">{renderInline(text)}</span>;
}

const RULES: { re: RegExp; render: (m: RegExpExecArray, key: number) => ReactNode }[] = [
  { re: /`([^`\n]+)`/, render: (m, k) => <code key={k}>{m[1]}</code> },
  { re: /\*\*([^*]+)\*\*/, render: (m, k) => <strong key={k}>{renderInline(m[1]!)}</strong> },
  { re: /__([^_]+)__/, render: (m, k) => <u key={k}>{renderInline(m[1]!)}</u> },
  { re: /~~([^~]+)~~/, render: (m, k) => <s key={k}>{renderInline(m[1]!)}</s> },
  { re: /\*([^*\n]+)\*/, render: (m, k) => <em key={k}>{renderInline(m[1]!)}</em> },
  {
    re: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/,
    render: (m, k) => (
      <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer nofollow">
        {m[1]}
      </a>
    ),
  },
  { re: /(^|\s)([@#][\w.\- ]{1,32}?)(?=$|\s|[.,!?])/, render: (m, k) => <Fragment key={k}>{m[1]}<span className="rounded bg-[#5865f2]/30 px-0.5 text-[#c9cdfb]">{m[2]}</span></Fragment> },
];

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    let best: { idx: number; m: RegExpExecArray; rule: (typeof RULES)[number] } | null = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.idx)) best = { idx: m.index, m, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.idx > 0) out.push(rest.slice(0, best.idx));
    out.push(best.rule.render(best.m, key++));
    rest = rest.slice(best.idx + best.m[0].length);
  }
  return out;
}

const BTN: Record<number, string> = {
  1: 'bg-[#5865f2] text-white',
  2: 'bg-[#4e5058] text-white',
  3: 'bg-[#248046] text-white',
  4: 'bg-[#da373c] text-white',
  5: 'bg-[#4e5058] text-white',
};

function emojiText(e?: { name?: string; id?: string }) {
  if (!e) return null;
  if (e.id) return <img src={`https://cdn.discordapp.com/emojis/${e.id}.webp?size=32`} alt={e.name ?? ''} className="size-4" />;
  return <span aria-hidden>{e.name}</span>;
}

export function RenderedPreview({ message, botName = 'Server Bot', botAvatar }: { message: RenderedMessage; botName?: string; botAvatar?: string }) {
  return (
    <div className="rounded-xl bg-discord-bg p-4 font-[system-ui] text-[15px] leading-[1.375rem] text-[#dbdee1]" aria-label="Discord message preview">
      <div className="flex gap-3">
        <div className="size-10 shrink-0 overflow-hidden rounded-full bg-brand">{botAvatar && <img src={botAvatar} alt="" className="size-10" />}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium text-white">{botName}</span> <span className="rounded bg-[#5865f2] px-1 text-[10px] font-semibold text-white">APP</span>{' '}
            <span className="text-xs text-[#949ba4]">Today at 12:00</span>
          </p>
          {message.content && (
            <div className="mt-0.5">
              <DiscordMarkdown text={message.content} />
            </div>
          )}
          {message.embeds.map((e, i) => (
            <div key={i} className="mt-2 grid max-w-[520px] rounded bg-discord-embed" style={{ borderLeft: `4px solid ${e.color !== undefined ? `#${e.color.toString(16).padStart(6, '0')}` : '#1e1f22'}` }}>
              <div className="flex gap-4 p-3 pr-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  {e.author && (
                    <p className="flex items-center gap-2 text-sm font-medium text-white">
                      {e.author.icon_url && <img src={e.author.icon_url} alt="" className="size-6 rounded-full" />}
                      {e.author.name}
                    </p>
                  )}
                  {e.title && <p className={cx('font-semibold', e.url ? 'text-[#00a8fc]' : 'text-white')}>{e.title}</p>}
                  {e.description && (
                    <div className="text-sm">
                      <DiscordMarkdown text={e.description} />
                    </div>
                  )}
                  {e.fields && (
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {e.fields.map((f, j) => (
                        <div key={j} className={cx('text-sm', f.inline ? 'col-span-1' : 'col-span-3')}>
                          <p className="font-semibold text-white">
                            <DiscordMarkdown text={f.name} />
                          </p>
                          <DiscordMarkdown text={f.value} />
                        </div>
                      ))}
                    </div>
                  )}
                  {e.image && <img src={e.image.url} alt="" className="mt-2 max-h-72 rounded" />}
                  {(e.footer || e.timestamp) && (
                    <p className="flex items-center gap-2 pt-1 text-xs text-[#949ba4]">
                      {e.footer?.icon_url && <img src={e.footer.icon_url} alt="" className="size-5 rounded-full" />}
                      {e.footer?.text}
                      {e.footer && e.timestamp && ' • '}
                      {e.timestamp && 'Today at 12:00'}
                    </p>
                  )}
                </div>
                {e.thumbnail && <img src={e.thumbnail.url} alt="" className="size-20 shrink-0 rounded object-cover" />}
              </div>
            </div>
          ))}
          {message.components.map((row, i) => (
            <div key={i} className="mt-2 flex flex-wrap gap-2">
              {row.components.map((c, j) =>
                c.type === 2 ? (
                  <span key={j} className={cx('inline-flex h-8 items-center gap-1.5 rounded px-4 text-sm font-medium', BTN[(c as RenderedButton).style], (c as RenderedButton).disabled && 'opacity-50')}>
                    {emojiText((c as RenderedButton).emoji)}
                    {(c as RenderedButton).label}
                    {(c as RenderedButton).style === 5 && <span aria-hidden>↗</span>}
                  </span>
                ) : (
                  <span key={j} className="flex h-10 w-full max-w-[400px] items-center justify-between rounded bg-[#1e1f22] px-3 text-sm text-[#949ba4]">
                    {(c as RenderedSelect).placeholder ?? 'Make a selection'}
                    <ChevronDown className="size-4" aria-hidden />
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Live preview of a template using sample variable values. Shows validation errors inline. */
export function TemplatePreview({ template, ctx }: { template: MessageTemplate; ctx?: Partial<VariableContext> }) {
  const parsed = messageTemplateSchema.safeParse(template);
  const rendered = renderMessageTemplate(parsed.success ? parsed.data : { ...template, embeds: template.embeds ?? [], components: [] }, sampleContext(ctx), { preview: true });
  return (
    <div className="space-y-2">
      <RenderedPreview message={rendered} />
      {!parsed.success && (
        <ul className="space-y-1 text-xs text-warn" role="status">
          {parsed.error.issues.slice(0, 5).map((i, k) => (
            <li key={k}>
              {i.path.length ? `${i.path.join(' › ')}: ` : ''}
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
