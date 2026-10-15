'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { DEFAULT_RULE, usageFor, type CmdSpec, type CommandRule, type CommandSettings } from '@aio/core/customize';
import { Alert, Badge, Card, NumberInput, PageHeader, PageSkeleton, TextInput, Toggle, cx } from '@/components/ui';
import { MultiChannelPicker, MultiRolePicker } from '@/components/pickers';
import { SaveBar } from '@/components/module';
import { useSettingsDoc } from '@/components/settings-doc';

interface CatalogEntry {
  module: string;
  data: CmdSpec & { default_member_permissions?: string | null };
}
interface Res {
  settings: CommandSettings;
  catalog: CatalogEntry[];
}

const MODULE_LABEL: Record<string, string> = {
  core: 'General',
  music: 'Music',
  tempvc: 'Voice rooms',
  embeds: 'Embeds',
  leveling: 'Leveling',
  moderation: 'Moderation',
  tickets: 'Tickets',
  verification: 'Verification',
  ai: 'AI helper',
};

function CommandRow({ entry, prefix, prefixOn, rule, onChange }: { entry: CatalogEntry; prefix: string; prefixOn: boolean; rule: CommandRule; onChange: (r: CommandRule) => void }) {
  const [open, setOpen] = useState(false);
  const name = entry.data.name;
  const restricted = rule.allowedRoleIds.length > 0 || rule.allowedChannelIds.length > 0;
  const [aliasText, setAliasText] = useState(rule.aliases.join(', '));
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <ChevronDown className={cx('mt-1 size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className={cx('font-mono text-sm font-semibold', !rule.enabled && 'text-muted line-through')}>/{name}</span>
              {prefixOn && rule.aliases.length > 0 && <span className="font-mono text-xs text-muted">{rule.aliases.map((a) => prefix + a).join(' ')}</span>}
              {entry.data.default_member_permissions && <Badge>Staff</Badge>}
              {restricted && <Badge tone="accent">Restricted</Badge>}
              {rule.cooldownSeconds > 0 && <Badge>{rule.cooldownSeconds}s cooldown</Badge>}
            </span>
            <span className="mt-0.5 block text-[13px] text-muted">{entry.data.description}</span>
            {prefixOn && <code className="mt-1 block truncate text-xs text-accent">{usageFor(prefix, entry.data)}</code>}
          </span>
        </button>
        <Toggle label={<span className="sr-only">Enable /{name}</span>} checked={rule.enabled} onChange={(enabled) => onChange({ ...rule, enabled })} />
      </div>
      {open && (
        <div className="mt-3 grid gap-4 rounded-xl border border-line bg-panel-2/40 p-4 sm:grid-cols-2">
          <TextInput
            label="Extra prefix names"
            hint={`Comma separated, e.g. "p" lets people type ${prefix}p. Up to 5.`}
            value={aliasText}
            onChange={(v) => {
              setAliasText(v);
              onChange({ ...rule, aliases: v.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean).slice(0, 5) });
            }}
            disabled={!prefixOn}
          />
          <NumberInput label="Cooldown (seconds)" hint="Per member. 0 means none. Admins skip it." value={rule.cooldownSeconds} min={0} max={3600} onChange={(v) => onChange({ ...rule, cooldownSeconds: v ?? 0 })} />
          <MultiRolePicker label="Only these roles" hint="Leave empty to allow everyone who has permission." value={rule.allowedRoleIds} onChange={(allowedRoleIds) => onChange({ ...rule, allowedRoleIds })} />
          <MultiChannelPicker label="Only in these channels" hint="Leave empty for every channel. Threads count as their parent." value={rule.allowedChannelIds} onChange={(allowedChannelIds) => onChange({ ...rule, allowedChannelIds })} />
          <div className="sm:col-span-2">
            <Toggle label="Delete the command message" description={`Removes the ${prefix}${name} message after it runs. Only for prefix commands.`} checked={rule.deleteTrigger} onChange={(deleteTrigger) => onChange({ ...rule, deleteTrigger })} disabled={!prefixOn} />
          </div>
        </div>
      )}
    </li>
  );
}

export default function CommandsPage() {
  const ctl = useSettingsDoc<CommandSettings, Res>('/api/customize/commands', (r) => r.settings);
  const [q, setQ] = useState('');
  const catalog = useMemo(() => ctl.res?.catalog ?? [], [ctl.res]);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<string, CatalogEntry[]>();
    for (const c of catalog) {
      if (needle && !c.data.name.includes(needle) && !(c.data.description ?? '').toLowerCase().includes(needle)) continue;
      map.set(c.module, [...(map.get(c.module) ?? []), c]);
    }
    return [...map.entries()];
  }, [catalog, q]);

  if (ctl.loadError) return <Alert tone="bad">{ctl.loadError}</Alert>;
  if (!ctl.draft) return <PageSkeleton label="Loading commands" />;
  const d = ctl.draft;
  const setRule = (name: string, rule: CommandRule) => ctl.setDraft({ ...d, commands: { ...d.commands, [name]: rule } });

  return (
    <div className="space-y-5 pb-24">
      <PageHeader title="Commands" description="Choose the prefix, turn commands on or off, and decide who can use them and where. These rules apply to slash and prefix commands alike." />

      <Card title="Prefix commands" description="Every slash command also works as a message, like +play never gonna give you up or +warn @user being bad.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Toggle label="Allow prefix commands" checked={d.prefixEnabled} onChange={(prefixEnabled) => ctl.setDraft({ ...d, prefixEnabled })} />
          <TextInput label="Prefix" hint="1 to 5 characters, no spaces. Can't start with @, # or <." value={d.prefix} maxLength={5} onChange={(prefix) => ctl.setDraft({ ...d, prefix })} error={ctl.errors.prefix} disabled={!d.prefixEnabled} />
        </div>
        {d.prefixEnabled && (
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Text after the command fills in the options in order, and the last text option takes the rest. You can also name options anywhere: <code className="text-accent">{d.prefix}ban @user spam delete_days:1</code>. Private replies are deleted after 20 seconds, and staff-only ones are sent by DM.
          </p>
        )}
      </Card>

      <Card
        title="All commands"
        description="Click a command for its rules. Commands marked Staff also need their Discord permission (for example Ban Members), even with a prefix."
        actions={
          <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-bg px-3 focus-within:border-accent">
            <Search className="size-4 text-muted" aria-hidden />
            <span className="sr-only">Search commands</span>
            <input className="w-40 bg-transparent text-sm outline-none" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        }
      >
        {catalog.length === 0 ? (
          <Alert tone="warn" title="The command list isn't available yet">
            The bot publishes it when it starts. Make sure the bot is running, then reload this page.
          </Alert>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted">No commands match.</p>
        ) : (
          <div className="space-y-6">
            {groups.map(([module, entries]) => (
              <section key={module}>
                <h3 className="text-[11px] font-semibold tracking-wider text-muted uppercase">{MODULE_LABEL[module] ?? module}</h3>
                <ul className="divide-y divide-line">
                  {entries.map((e) => (
                    <CommandRow key={e.data.name} entry={e} prefix={d.prefix} prefixOn={d.prefixEnabled} rule={{ ...DEFAULT_RULE, ...d.commands[e.data.name] }} onChange={(r) => setRule(e.data.name, r)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
      <SaveBar dirty={ctl.dirty} saving={ctl.saving} onSave={ctl.save} onReset={ctl.reset} errorCount={Object.keys(ctl.errors).length} />
    </div>
  );
}
