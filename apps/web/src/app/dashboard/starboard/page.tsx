'use client';

import { Advanced, Alert, Card, NumberInput, TextInput, Toggle } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { ChannelPicker, MultiChannelPicker } from '@/components/pickers';

interface StarboardSettings {
  channelId?: string;
  emoji: string;
  threshold: number;
  allowSelfStar: boolean;
  ignoredChannelIds: string[];
  includeNsfw: boolean;
}

export default function StarboardPage() {
  const ctl = useModuleSettings<StarboardSettings>('starboard');
  const s = ctl.draft;
  return (
    <ModuleShell
      title="Starboard"
      description="When a message gets enough stars, the bot shares a copy in your starboard channel and keeps the count up to date."
      ctl={ctl}
    >
      {s && (
        <>
          {ctl.data?.enabled && !s.channelId && <Alert tone="warn" title="Pick a starboard channel">Nothing gets posted until you choose where starred messages go.</Alert>}
          <Card title="Starboard">
            <div className="grid gap-5 md:grid-cols-2">
              <ChannelPicker label="Starboard channel" value={s.channelId} onChange={(channelId) => ctl.update({ channelId })} error={ctl.errors.channelId} />
              <NumberInput label="Stars needed" value={s.threshold} min={1} max={100} onChange={(v) => ctl.update({ threshold: v ?? 3 })} error={ctl.errors.threshold} />
              <TextInput label="Emoji" hint="One emoji, or a custom one like <:star:123…>." value={s.emoji} onChange={(emoji) => ctl.update({ emoji })} maxLength={64} error={ctl.errors.emoji} />
            </div>
            <p className="mt-4 text-sm text-muted">Messages from channels that some starboard readers can't see, like staff channels, are never copied.</p>
          </Card>
          <Advanced>
            <div className="space-y-1">
              <Toggle label="Count people starring their own message" checked={s.allowSelfStar} onChange={(allowSelfStar) => ctl.update({ allowSelfStar })} />
              <Toggle label="Include age-restricted channels" checked={s.includeNsfw} onChange={(includeNsfw) => ctl.update({ includeNsfw })} />
            </div>
            <div className="mt-4">
              <MultiChannelPicker label="Ignored channels" hint="Messages here never reach the starboard." value={s.ignoredChannelIds} onChange={(ignoredChannelIds) => ctl.update({ ignoredChannelIds })} />
            </div>
          </Advanced>
        </>
      )}
    </ModuleShell>
  );
}
