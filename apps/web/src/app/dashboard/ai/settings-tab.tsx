'use client';

import { Advanced, Alert, Card, NumberInput, Select, TextArea, TextInput, Toggle } from '@/components/ui';
import { ChannelPicker, MultiRolePicker } from '@/components/pickers';
import type { AiSettings } from './types';

export function SettingsTab({ s, update, errors }: { s: AiSettings; update: (p: Partial<AiSettings>) => void; errors: Record<string, string> }) {
  return (
    <>
      {!s.outputChannelId && <Alert tone="warn" title="Choose an AI channel">The helper only ever replies in one channel. Until you choose it, the AI stays silent.</Alert>}
      <Card title="Where the helper talks" description="The AI only reads the channels on the Context tab and only writes in this one channel. It never moderates.">
        <div className="grid gap-5 md:grid-cols-2">
          <ChannelPicker label="AI channel" value={s.outputChannelId} onChange={(outputChannelId) => update({ outputChannelId })} error={errors.outputChannelId} />
        </div>
      </Card>
      <Card title="What makes it answer" description="Whole words only, case-insensitive: “help” matches “Help!” but “apple” never matches “pineapple”.">
        <div className="grid gap-5 md:grid-cols-2">
          <Toggle label="When the bot is mentioned" checked={s.triggers.mention} onChange={(mention) => update({ triggers: { ...s.triggers, mention } })} />
          <TextInput
            label="Trigger words"
            hint="Comma separated. Default: help, apple"
            value={s.triggers.words.join(', ')}
            onChange={(v) => update({ triggers: { ...s.triggers, words: v.split(',').map((w) => w.trim()).filter(Boolean).slice(0, 20) } })}
            error={errors['triggers.words.0'] ?? errors['triggers.words']}
          />
          <div className="md:col-span-2">
            <MultiRolePicker label="When these roles are mentioned" value={s.triggers.roleIds} onChange={(roleIds) => update({ triggers: { ...s.triggers, roleIds } })} />
          </div>
        </div>
      </Card>
      <Card title="Personality">
        <div className="grid gap-5 md:grid-cols-[1fr_14rem]">
          <TextArea label="Persona" hint="Server context is data, never instructions, so members cannot change these rules by posting." value={s.persona} onChange={(persona) => update({ persona })} maxLength={4000} rows={4} />
          <Select
            label="Tone"
            value={s.tone}
            onChange={(tone) => update({ tone })}
            options={[
              { value: 'friendly', label: 'Friendly' },
              { value: 'concise', label: 'Concise' },
              { value: 'formal', label: 'Formal' },
              { value: 'playful', label: 'Playful' },
            ]}
          />
        </div>
      </Card>
      <Advanced>
        <div className="grid gap-5 md:grid-cols-3">
          <NumberInput label="Sources per answer" min={1} max={30} value={s.retrieval.maxSources} onChange={(v) => update({ retrieval: { ...s.retrieval, maxSources: v ?? 8 } })} />
          <NumberInput label="Recent conversation turns" min={0} max={20} value={s.retrieval.recentTurns} onChange={(v) => update({ retrieval: { ...s.retrieval, recentTurns: v ?? 6 } })} />
          <Toggle label="Read images attached to questions" checked={s.vision.enabled} onChange={(enabled) => update({ vision: { ...s.vision, enabled } })} />
          <NumberInput label="Questions per member per minute" min={1} max={60} value={s.limits.perUserPerMinute} onChange={(v) => update({ limits: { ...s.limits, perUserPerMinute: v ?? 6 } })} />
          <NumberInput label="Questions per minute (server)" min={1} max={1000} value={s.limits.globalPerMinute} onChange={(v) => update({ limits: { ...s.limits, globalPerMinute: v ?? 60 } })} />
          <NumberInput label="Parallel questions per member" min={1} max={5} value={s.limits.concurrentPerUser} onChange={(v) => update({ limits: { ...s.limits, concurrentPerUser: v ?? 1 } })} />
          <Toggle label="Use the stronger model for long questions" checked={s.escalation.enabled} onChange={(enabled) => update({ escalation: { ...s.escalation, enabled } })} />
          <NumberInput label="“Long question” threshold (characters)" min={50} max={4000} value={s.escalation.minQuestionChars} onChange={(v) => update({ escalation: { ...s.escalation, minQuestionChars: v ?? 400 } })} />
        </div>
      </Advanced>
    </>
  );
}
