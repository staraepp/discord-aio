'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button, NumberInput, Select, TextArea, TextInput } from './ui';
import { ChannelPicker, RolePicker } from './pickers';

export type ActionSpec =
  | { type: 'send_text'; text: string; channelId?: string }
  | { type: 'send_embed'; embedId: string; channelId?: string }
  | { type: 'dm_user'; text: string }
  | { type: 'add_role' | 'remove_role' | 'toggle_role'; roleId: string }
  | { type: 'delete_trigger' }
  | { type: 'delete_response_after'; seconds: number }
  | { type: 'react'; emoji: string }
  | { type: 'log'; text: string; channelId?: string };

const LABELS: Record<ActionSpec['type'], string> = {
  send_text: 'Send text',
  send_embed: 'Send saved embed',
  dm_user: 'DM the user',
  add_role: 'Add role',
  remove_role: 'Remove role',
  toggle_role: 'Toggle role',
  delete_trigger: 'Delete triggering message',
  delete_response_after: 'Delete bot response after N seconds',
  react: 'React with emoji',
  log: 'Write a log line',
};

function defaults(type: ActionSpec['type']): ActionSpec {
  switch (type) {
    case 'send_text':
    case 'dm_user':
    case 'log':
      return { type, text: 'Hello {user}!' } as ActionSpec;
    case 'send_embed':
      return { type, embedId: '' };
    case 'add_role':
    case 'remove_role':
    case 'toggle_role':
      return { type, roleId: '' };
    case 'delete_response_after':
      return { type, seconds: 30 };
    case 'react':
      return { type, emoji: '🥹' };
    default:
      return { type };
  }
}

/** Shared action-chain editor (autoresponders, saved-embed buttons). No economy actions exist. */
export function ActionsEditor({ value, onChange, embeds, allowTriggerActions = true, max = 10 }: { value: ActionSpec[]; onChange: (v: ActionSpec[]) => void; embeds: { id: string; name: string }[]; allowTriggerActions?: boolean; max?: number }) {
  const types = (Object.keys(LABELS) as ActionSpec['type'][]).filter((t) => allowTriggerActions || (t !== 'delete_trigger' && t !== 'react'));
  const set = (i: number, a: ActionSpec) => onChange(value.map((x, j) => (j === i ? a : x)));
  return (
    <div className="space-y-3">
      {value.map((a, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-line p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Select label={`Step ${i + 1}`} value={a.type} onChange={(t) => set(i, defaults(t))} options={types.map((t) => ({ value: t, label: LABELS[t] }))} />
            </div>
            <Button variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
          {'text' in a && <TextArea label="Text" value={a.text} onChange={(text) => set(i, { ...a, text })} rows={2} maxLength={a.type === 'log' ? 1000 : 2000} />}
          {a.type === 'send_embed' && (
            <Select label="Saved embed" value={a.embedId} onChange={(embedId) => set(i, { ...a, embedId })} options={[{ value: '', label: 'Choose…' }, ...embeds.map((e) => ({ value: e.id, label: e.name }))]} />
          )}
          {(a.type === 'send_text' || a.type === 'send_embed' || a.type === 'log') && (
            <ChannelPicker label="Channel" hint={a.type === 'log' ? 'Defaults to the module log channel.' : 'Leave empty to reply in the same channel.'} value={a.channelId} onChange={(channelId) => set(i, { ...a, channelId })} />
          )}
          {(a.type === 'add_role' || a.type === 'remove_role' || a.type === 'toggle_role') && (
            <RolePicker label="Role" hint="The bot's highest role must be above this role." value={a.roleId || undefined} onChange={(roleId) => set(i, { ...a, roleId: roleId ?? '' })} />
          )}
          {a.type === 'delete_response_after' && <NumberInput label="Seconds" min={1} max={3600} value={a.seconds} onChange={(s) => set(i, { ...a, seconds: s ?? 30 })} />}
          {a.type === 'react' && <TextInput label="Emoji" value={a.emoji} onChange={(emoji) => set(i, { ...a, emoji })} />}
        </div>
      ))}
      <Button size="sm" disabled={value.length >= max} onClick={() => onChange([...value, defaults('send_text')])}>
        <Plus className="size-4" /> Add action
      </Button>
    </div>
  );
}
