'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Advanced, Button, Card, NumberInput, Select, Spinner, Tabs, TextArea, Toggle } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { ChannelPicker, MultiChannelPicker, MultiRolePicker, RolePicker, useRoleName } from '@/components/pickers';
import { useToast } from '@/components/providers';

type Preset = 'casual' | 'active' | 'competitive' | 'custom';
interface LevelingSettings {
  preset: Preset;
  textXp: boolean;
  voiceXp: boolean;
  cooldownSeconds: number;
  xpMin: number;
  xpMax: number;
  voiceXpPerMinute: number;
  formula: 'linear' | 'quadratic' | 'exponential';
  difficulty: number;
  ignoredChannelIds: string[];
  ignoredRoleIds: string[];
  bonusChannels: { id: string; multiplier: number }[];
  bonusRoles: { id: string; multiplier: number }[];
  levelUpNotify: boolean;
  levelUpChannelId?: string;
  levelUpMessage: string;
  levelUpEmbedId?: string;
  rankEnabled: boolean;
  leaderboardEnabled: boolean;
  allowOptOut: boolean;
  staffMode: 'normal' | 'no_xp' | 'bonus';
  staffMultiplier: number;
  stackRewards: boolean;
}

/** Mirrors the server presets so the form updates immediately; the server re-validates on save. */
const PRESETS: Record<Exclude<Preset, 'custom'>, Partial<LevelingSettings>> = {
  casual: { cooldownSeconds: 60, xpMin: 15, xpMax: 25, formula: 'quadratic', difficulty: 1, voiceXp: false },
  active: { cooldownSeconds: 45, xpMin: 20, xpMax: 30, formula: 'quadratic', difficulty: 0.8, voiceXp: true, voiceXpPerMinute: 3 },
  competitive: { cooldownSeconds: 60, xpMin: 10, xpMax: 20, formula: 'exponential', difficulty: 1.25, voiceXp: true, voiceXpPerMinute: 2 },
};

interface Reward {
  id: string;
  level: number;
  roleId: string;
}
interface Member {
  rank: number;
  userId: string;
  xp: number;
  level: number;
  messageCount: number;
  voiceMinutes: number;
  optedOut: boolean;
}

export default function LevelingPage() {
  const ctl = useModuleSettings<LevelingSettings>('leveling');
  const [tab, setTab] = useState<'settings' | 'rewards' | 'leaderboard'>('settings');
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [newReward, setNewReward] = useState<{ level: number | null; roleId?: string }>({ level: 5 });
  const [members, setMembers] = useState<Member[] | null>(null);
  const [curve, setCurve] = useState<{ level: number; total: number }[]>([]);
  const { notify, fail } = useToast();
  const roleName = useRoleName();
  const s = ctl.draft;

  const loadRewards = useCallback(() => api<Reward[]>('/api/leveling/rewards').then(setRewards).catch(fail), [fail]);
  useEffect(() => {
    void loadRewards();
    api<{ items: Member[] }>('/api/leveling/members')
      .then((r) => setMembers(r.items))
      .catch(fail);
  }, [loadRewards, fail]);

  useEffect(() => {
    if (!s) return;
    const t = setTimeout(() => {
      api<{ level: number; total: number }[]>('/api/leveling/preview', { body: { formula: s.formula, difficulty: s.difficulty } })
        .then(setCurve)
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [s?.formula, s?.difficulty]);

  const applyPreset = (preset: Preset) => {
    if (!s) return;
    ctl.setDraft({ ...s, preset, ...(preset !== 'custom' ? PRESETS[preset] : {}) });
  };

  return (
    <ModuleShell title="Leveling" description="Members earn XP for chatting (and optionally voice). Level-up messages and role rewards are configurable." ctl={ctl}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'settings', label: 'Settings' },
          { id: 'rewards', label: 'Role rewards' },
          { id: 'leaderboard', label: 'Leaderboard' },
        ]}
      />
      {tab === 'settings' && s && (
        <>
          <Card title="How fast members level up">
            <div className="grid gap-5 md:grid-cols-2">
              <Select
                label="Preset"
                value={s.preset}
                onChange={applyPreset}
                options={[
                  { value: 'casual', label: 'Casual: steady, friendly pace' },
                  { value: 'active', label: 'Active: for busy servers' },
                  { value: 'competitive', label: 'Competitive: slower at high levels' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
              <div className="space-y-1">
                <Toggle label="XP for messages" checked={s.textXp} onChange={(textXp) => ctl.update({ textXp })} />
                <Toggle label="XP for time in voice" checked={s.voiceXp} onChange={(voiceXp) => ctl.update({ voiceXp })} />
              </div>
            </div>
            {curve.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <p className="mb-1 text-xs text-muted">Total XP needed</p>
                <table className="text-sm">
                  <tbody>
                    <tr>
                      {curve.map((c) => (
                        <th key={c.level} className="px-3 text-left text-xs font-normal text-muted">
                          Lv {c.level}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {curve.map((c) => (
                        <td key={c.level} className="px-3">
                          {c.total.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Level-up message">
            <div className="grid gap-5 md:grid-cols-2">
              <Toggle label="Announce level-ups" checked={s.levelUpNotify} onChange={(levelUpNotify) => ctl.update({ levelUpNotify })} />
              <ChannelPicker label="Announcement channel" hint="Empty = the channel where they leveled up." value={s.levelUpChannelId} onChange={(levelUpChannelId) => ctl.update({ levelUpChannelId })} />
              <div className="md:col-span-2">
                <TextArea label="Message" hint="Variables: {user}, {user.name}, {level}, {xp}" value={s.levelUpMessage} onChange={(levelUpMessage) => ctl.update({ levelUpMessage })} maxLength={2000} rows={2} />
              </div>
            </div>
          </Card>
          <Advanced>
            <div className="grid gap-5 md:grid-cols-2">
              <NumberInput label="Cooldown between XP (seconds)" min={0} max={3600} value={s.cooldownSeconds} onChange={(v) => ctl.update({ cooldownSeconds: v ?? 60, preset: 'custom' })} />
              <NumberInput label="Voice XP per minute" min={0} max={100} value={s.voiceXpPerMinute} onChange={(v) => ctl.update({ voiceXpPerMinute: v ?? 0 })} />
              <NumberInput label="Minimum XP per message" min={1} max={1000} value={s.xpMin} onChange={(v) => ctl.update({ xpMin: v ?? 1, preset: 'custom' })} error={ctl.errors.xpMin} />
              <NumberInput label="Maximum XP per message" min={1} max={1000} value={s.xpMax} onChange={(v) => ctl.update({ xpMax: v ?? 1, preset: 'custom' })} error={ctl.errors.xpMax} />
              <Select
                label="Curve"
                value={s.formula}
                onChange={(formula) => ctl.update({ formula, preset: 'custom' })}
                options={[
                  { value: 'linear', label: 'Linear' },
                  { value: 'quadratic', label: 'Quadratic' },
                  { value: 'exponential', label: 'Exponential' },
                ]}
              />
              <NumberInput label="Difficulty" min={0.25} max={5} step={0.25} value={s.difficulty} onChange={(v) => ctl.update({ difficulty: v ?? 1, preset: 'custom' })} />
              <MultiChannelPicker label="No XP in these channels" value={s.ignoredChannelIds} onChange={(ignoredChannelIds) => ctl.update({ ignoredChannelIds })} />
              <MultiRolePicker label="No XP for these roles" value={s.ignoredRoleIds} onChange={(ignoredRoleIds) => ctl.update({ ignoredRoleIds })} />
              <Select
                label="Staff XP"
                value={s.staffMode}
                onChange={(staffMode) => ctl.update({ staffMode })}
                options={[
                  { value: 'normal', label: 'Same as everyone' },
                  { value: 'no_xp', label: 'Staff earn no XP' },
                  { value: 'bonus', label: 'Staff earn bonus XP' },
                ]}
              />
              {s.staffMode === 'bonus' && <NumberInput label="Staff multiplier" min={1} max={5} step={0.1} value={s.staffMultiplier} onChange={(v) => ctl.update({ staffMultiplier: v ?? 1 })} />}
              <Toggle label="Keep lower reward roles when leveling up" checked={s.stackRewards} onChange={(stackRewards) => ctl.update({ stackRewards })} />
              <Toggle label="/rank command" checked={s.rankEnabled} onChange={(rankEnabled) => ctl.update({ rankEnabled })} />
              <Toggle label="/leaderboard command" checked={s.leaderboardEnabled} onChange={(leaderboardEnabled) => ctl.update({ leaderboardEnabled })} />
              <Toggle label="Members can opt out of leveling" checked={s.allowOptOut} onChange={(allowOptOut) => ctl.update({ allowOptOut })} />
            </div>
            <BonusEditor title="Bonus channels" kind="channel" value={s.bonusChannels} onChange={(bonusChannels) => ctl.update({ bonusChannels })} />
            <BonusEditor title="Bonus roles" kind="role" value={s.bonusRoles} onChange={(bonusRoles) => ctl.update({ bonusRoles })} />
          </Advanced>
        </>
      )}
      {tab === 'rewards' && (
        <Card title="Role rewards" description="Members receive these roles when they reach the level. The bot's role must be higher than each reward role.">
          <div className="mb-4 grid items-end gap-3 sm:grid-cols-[8rem_1fr_auto]">
            <NumberInput label="Level" min={1} max={1000} value={newReward.level} onChange={(level) => setNewReward({ ...newReward, level })} />
            <RolePicker label="Role" value={newReward.roleId} onChange={(roleId) => setNewReward({ ...newReward, roleId })} />
            <Button
              variant="primary"
              disabled={!newReward.roleId || !newReward.level}
              onClick={async () => {
                try {
                  await api('/api/leveling/rewards', { body: { level: newReward.level, roleId: newReward.roleId } });
                  notify('Reward added.');
                  setNewReward({ level: newReward.level });
                  void loadRewards();
                } catch (e) {
                  fail(e);
                }
              }}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
          {rewards.length === 0 ? (
            <p className="text-sm text-muted">No rewards yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rewards.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    Level <b>{r.level}</b> → @{roleName(r.roleId)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove reward"
                    onClick={async () => {
                      try {
                        await api(`/api/leveling/rewards/${r.id}`, { method: 'DELETE' });
                        void loadRewards();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'leaderboard' && (
        <Card title="Leaderboard" description="Staff can adjust XP with /xp in Discord so reward roles stay in sync.">
          {!members ? (
            <Spinner />
          ) : members.length === 0 ? (
            <p className="text-sm text-muted">No XP earned yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted uppercase">
                <tr>
                  <th className="py-2">#</th>
                  <th>Member</th>
                  <th>Level</th>
                  <th>XP</th>
                  <th>Messages</th>
                  <th>Voice min</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((m) => (
                  <tr key={m.userId} className={m.optedOut ? 'text-muted' : ''}>
                    <td className="py-2">{m.rank}</td>
                    <td className="font-mono text-xs">{m.userId}</td>
                    <td>{m.level}</td>
                    <td>{m.xp.toLocaleString()}</td>
                    <td>{m.messageCount}</td>
                    <td>{m.voiceMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </ModuleShell>
  );
}

function BonusEditor({ title, kind, value, onChange }: { title: string; kind: 'channel' | 'role'; value: { id: string; multiplier: number }[]; onChange: (v: { id: string; multiplier: number }[]) => void }) {
  const [pick, setPick] = useState<string | undefined>();
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {value.map((b, i) => (
        <div key={b.id} className="flex items-end gap-2">
          <span className="flex-1 font-mono text-xs">{b.id}</span>
          <NumberInput label="Multiplier" min={1} max={10} step={0.1} value={b.multiplier} onChange={(m) => onChange(value.map((x, j) => (j === i ? { ...x, multiplier: m ?? 1 } : x)))} />
          <Button variant="ghost" aria-label="Remove bonus" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-end gap-2">
        <div className="flex-1">{kind === 'channel' ? <ChannelPicker label={`Add ${kind}`} value={pick} onChange={setPick} /> : <RolePicker label={`Add ${kind}`} value={pick} onChange={setPick} />}</div>
        <Button
          size="sm"
          disabled={!pick || value.some((v) => v.id === pick)}
          onClick={() => {
            if (pick) onChange([...value, { id: pick, multiplier: 1.5 }]);
            setPick(undefined);
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
