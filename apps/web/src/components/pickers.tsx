'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Folder, Hash, Lock, Search, Volume2, X } from 'lucide-react';
import { Field, cx, fieldDescribedBy } from './ui';
import { useResources, type GuildChannel, type GuildRole } from './providers';

export const CH = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 } as const;
export const TEXT_TYPES = [CH.text, CH.announcement];

function channelIcon(c: GuildChannel) {
  if (c.type === CH.category) return <Folder className="size-3.5" aria-hidden />;
  if (c.type === CH.voice || c.type === CH.stage) return <Volume2 className="size-3.5" aria-hidden />;
  return c.everyoneCanView ? <Hash className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />;
}

export function roleColor(r: GuildRole | undefined): string {
  return r && r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#99aab5';
}

/** Falls back to a manual ID input when Discord data is unavailable (IDs are still validated server-side). */
function ManualIds({ id, value, onChange, multiple }: { id: string; value: string[]; onChange: (v: string[]) => void; multiple: boolean }) {
  return (
    <input
      id={id}
      className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-base hover:border-line-strong focus:border-accent sm:h-10 sm:text-sm"
      placeholder={multiple ? 'Server data unavailable, paste IDs separated by commas' : 'Server data unavailable, paste a Discord ID'}
      value={value.join(', ')}
      onChange={(e) =>
        onChange(
          e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, multiple ? 100 : 1),
        )
      }
    />
  );
}

interface Option {
  id: string;
  name: string;
  /** Section heading shown above this option (e.g. its channel category). */
  group?: string;
}

/**
 * Searchable dropdown in the listbox pattern: a trigger button that shows the current choice,
 * and a popover with a filter box, arrow-key navigation and a check on selected rows.
 */
function Dropdown<T extends Option>({
  triggerId,
  items,
  selected,
  onToggle,
  render,
  summary,
  placeholder,
  searchLabel,
  multiple,
  onClear,
  describedBy,
}: {
  triggerId: string;
  items: T[];
  selected: string[];
  onToggle: (id: string) => void;
  render: (item: T) => ReactNode;
  summary: ReactNode;
  placeholder: string;
  searchLabel: string;
  multiple: boolean;
  onClear?: () => void;
  describedBy?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(needle)).slice(0, 100);
  }, [items, q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQ('');
    if (refocus) triggerRef.current?.focus();
  };
  const openList = () => {
    const first = filtered.findIndex((i) => selected.includes(i.id));
    setActive(first >= 0 ? first : 0);
    setOpen(true);
  };
  const choose = (item: T) => {
    onToggle(item.id);
    if (!multiple) close(true);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : filtered.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[active];
      if (item) choose(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    }
  };

  const optionId = (i: number) => `${listId}-o${i}`;
  const hasValue = selected.length > 0;

  return (
    <div className="relative" onBlur={(e) => open && !e.currentTarget.contains(e.relatedTarget) && close(false)}>
      <div className="flex gap-2">
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-describedby={describedBy}
          onClick={() => (open ? close(false) : openList())}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              openList();
            }
          }}
          className={cx(
            'flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-bg px-3 text-left text-base transition-colors hover:border-line-strong sm:h-10 sm:text-sm',
            open ? 'border-accent' : 'border-line',
          )}
        >
          <span className={cx('flex min-w-0 flex-1 items-center gap-1.5 truncate', !hasValue || multiple ? 'text-muted' : 'text-text')}>{hasValue && !multiple ? summary : placeholder}</span>
          <ChevronDown className={cx('size-4 shrink-0 text-muted transition-transform duration-150', open && 'rotate-180')} aria-hidden />
        </button>
        {onClear && hasValue && !multiple && (
          <button type="button" onClick={onClear} className="grid size-11 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-line-strong hover:text-text sm:size-10" aria-label="Clear selection" title="Clear">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <div className="animate-fade-in absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line-strong bg-panel-2 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-label={searchLabel}
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered[active] ? optionId(active) : undefined}
              className="h-10 w-full bg-transparent text-base outline-none placeholder:text-muted sm:text-sm"
              placeholder="Type to filter"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={searchLabel} aria-multiselectable={multiple || undefined} className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-muted">{items.length === 0 ? 'Nothing to pick here yet' : 'No matches'}</li>}
            {filtered.map((item, i) => {
              const isSelected = selected.includes(item.id);
              const showGroup = item.group !== undefined && item.group !== filtered[i - 1]?.group;
              return (
                <Fragment key={item.id}>
                  {showGroup && (
                    <li role="presentation" className="px-2 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {item.group || 'No category'}
                    </li>
                  )}
                  <li
                    id={optionId(i)}
                    data-index={i}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(item)}
                    className={cx('flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm', i === active && 'bg-panel-3', isSelected && 'text-text')}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{render(item)}</span>
                    {isSelected && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Chip({ children, onRemove, removeLabel, color }: { children: ReactNode; onRemove: () => void; removeLabel: string; color?: string }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-line-strong bg-panel-2 py-0.5 pr-1 pl-2.5 text-sm" style={color ? { borderColor: `${color}88` } : undefined}>
      {children}
      <button type="button" onClick={onRemove} className="grid size-5 place-items-center rounded-full text-muted transition-colors hover:bg-panel-3 hover:text-text" aria-label={removeLabel}>
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/** Channels in Discord's sidebar order, each tagged with its category name. */
function channelOptions(all: GuildChannel[], types: number[]) {
  const categories = all.filter((c) => c.type === CH.category).sort((a, b) => a.position - b.position);
  const byParent = (parentId: string | null) =>
    all
      .filter((c) => c.parentId === parentId && c.type !== CH.category && types.includes(c.type))
      .sort((a, b) => a.position - b.position);
  const out: (GuildChannel & { group?: string })[] = byParent(null).map((c) => ({ ...c, group: '' }));
  for (const cat of categories) {
    if (types.includes(CH.category)) out.push({ ...cat, group: 'Categories' });
    out.push(...byParent(cat.id).map((c) => ({ ...c, group: cat.name })));
  }
  return out;
}

function channelKind(types: number[]): string {
  if (types.every((t) => t === CH.category)) return 'category';
  if (types.every((t) => t === CH.voice || t === CH.stage)) return 'voice channel';
  return 'channel';
}

const channelRow = (c: GuildChannel) => (
  <>
    <span className="shrink-0 text-muted">{channelIcon(c)}</span>
    <span className="truncate">{c.name}</span>
  </>
);

const roleRow = (r: GuildRole) => (
  <>
    <span className="size-2.5 shrink-0 rounded-full" style={{ background: roleColor(r) }} aria-hidden />
    <span className="truncate">{r.name}</span>
    {r.managed && <span className="shrink-0 text-xs text-muted">(bot role)</span>}
  </>
);

const sortedRoles = (roles: GuildRole[]) => roles.filter((r) => !r.isEveryone).sort((a, b) => b.position - a.position);

export function ChannelPicker({
  label,
  hint,
  error,
  value,
  onChange,
  types = TEXT_TYPES,
  allowClear = true,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  value: string | null | undefined;
  onChange: (v: string | undefined) => void;
  types?: number[];
  allowClear?: boolean;
}) {
  const id = useId();
  const { data } = useResources();
  const items = useMemo(() => channelOptions(data?.channels ?? [], types), [data, types]);
  const current = data?.channels.find((c) => c.id === value);
  const kind = channelKind(types);
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      {!data ? (
        <ManualIds id={id} value={value ? [value] : []} onChange={(v) => onChange(v[0])} multiple={false} />
      ) : (
        <Dropdown
          triggerId={id}
          items={items}
          selected={value ? [value] : []}
          multiple={false}
          placeholder={`Choose a ${kind}`}
          searchLabel={`Filter ${kind}s`}
          summary={current ? channelRow(current) : `Unknown ${kind} (${value})`}
          onToggle={(v) => onChange(v)}
          onClear={allowClear ? () => onChange(undefined) : undefined}
          describedBy={fieldDescribedBy(id, hint, error)}
          render={channelRow}
        />
      )}
    </Field>
  );
}

export function MultiChannelPicker({ label, hint, value, onChange, types = TEXT_TYPES }: { label: ReactNode; hint?: ReactNode; value: string[]; onChange: (v: string[]) => void; types?: number[] }) {
  const id = useId();
  const { data } = useResources();
  const items = useMemo(() => channelOptions(data?.channels ?? [], types), [data, types]);
  const kind = channelKind(types);
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      {!data ? (
        <ManualIds id={id} value={value} onChange={onChange} multiple />
      ) : (
        <div className="space-y-2">
          <Dropdown
            triggerId={id}
            items={items}
            selected={value}
            multiple
            placeholder={value.length ? `${value.length} selected, add more` : `Add ${kind}s`}
            searchLabel={`Filter ${kind}s`}
            summary={null}
            onToggle={(v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])}
            describedBy={fieldDescribedBy(id, hint)}
            render={channelRow}
          />
          {value.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {value.map((cid) => {
                const c = data.channels.find((x) => x.id === cid);
                return (
                  <Chip key={cid} removeLabel={`Remove ${c?.name ?? cid}`} onRemove={() => onChange(value.filter((v) => v !== cid))}>
                    {c ? channelIcon(c) : null}
                    {c?.name ?? `Unknown (${cid})`}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

export function RolePicker({ label, hint, error, value, onChange }: { label: ReactNode; hint?: ReactNode; error?: string; value: string | null | undefined; onChange: (v: string | undefined) => void }) {
  const id = useId();
  const { data } = useResources();
  const items = useMemo(() => sortedRoles(data?.roles ?? []), [data]);
  const current = data?.roles.find((r) => r.id === value);
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      {!data ? (
        <ManualIds id={id} value={value ? [value] : []} onChange={(v) => onChange(v[0])} multiple={false} />
      ) : (
        <Dropdown
          triggerId={id}
          items={items}
          selected={value ? [value] : []}
          multiple={false}
          placeholder="Choose a role"
          searchLabel="Filter roles"
          summary={current ? roleRow(current) : `Unknown role (${value})`}
          onToggle={(v) => onChange(v)}
          onClear={() => onChange(undefined)}
          describedBy={fieldDescribedBy(id, hint, error)}
          render={roleRow}
        />
      )}
    </Field>
  );
}

export function MultiRolePicker({ label, hint, value, onChange }: { label: ReactNode; hint?: ReactNode; value: string[]; onChange: (v: string[]) => void }) {
  const id = useId();
  const { data } = useResources();
  const items = useMemo(() => sortedRoles(data?.roles ?? []), [data]);
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      {!data ? (
        <ManualIds id={id} value={value} onChange={onChange} multiple />
      ) : (
        <div className="space-y-2">
          <Dropdown
            triggerId={id}
            items={items}
            selected={value}
            multiple
            placeholder={value.length ? `${value.length} selected, add more` : 'Add roles'}
            searchLabel="Filter roles"
            summary={null}
            onToggle={(v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])}
            describedBy={fieldDescribedBy(id, hint)}
            render={roleRow}
          />
          {value.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {value.map((rid) => {
                const r = data.roles.find((x) => x.id === rid);
                return (
                  <Chip key={rid} color={roleColor(r)} removeLabel={`Remove ${r?.name ?? rid}`} onRemove={() => onChange(value.filter((v) => v !== rid))}>
                    <span className="size-2 rounded-full" style={{ background: roleColor(r) }} aria-hidden />
                    {r?.name ?? `Unknown (${rid})`}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

export function useChannelName() {
  const { data } = useResources();
  return (id: string | null | undefined) => (id ? (data?.channels.find((c) => c.id === id)?.name ?? id) : 'none');
}

export function useRoleName() {
  const { data } = useResources();
  return (id: string | null | undefined) => (id ? (data?.roles.find((r) => r.id === id)?.name ?? id) : 'none');
}
