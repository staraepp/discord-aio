'use client';

import { Card, NumberInput } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';

interface PollSettings {
  maxDurationHours: number;
}

export default function PollsPage() {
  const ctl = useModuleSettings<PollSettings>('polls');
  const s = ctl.draft;
  return (
    <ModuleShell title="Polls" description="Anyone can ask the server a question with /poll. It uses Discord's own polls, so votes and results show right in the chat." ctl={ctl}>
      {s && (
        <Card title="Limits">
          <NumberInput label="Longest poll (hours)" hint="Discord allows up to 768 hours (32 days). Polls default to 24 hours." value={s.maxDurationHours} min={1} max={768} onChange={(v) => ctl.update({ maxDurationHours: v ?? 168 })} error={ctl.errors.maxDurationHours} />
        </Card>
      )}
    </ModuleShell>
  );
}
