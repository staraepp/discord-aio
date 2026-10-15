'use client';

import { Card, NumberInput, Toggle } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';

interface ReminderSettings {
  maxPerUser: number;
  allowChannelReminders: boolean;
}

export default function RemindersPage() {
  const ctl = useModuleSettings<ReminderSettings>('reminders');
  const s = ctl.draft;
  return (
    <ModuleShell title="Reminders" description="Members set reminders with /remind me and the bot DMs them when it's time. If their DMs are closed, it pings them where they asked instead." ctl={ctl}>
      {s && (
        <Card title="Limits">
          <div className="grid gap-5 md:grid-cols-2">
            <NumberInput label="Reminders per member" hint="How many can be waiting at once." value={s.maxPerUser} min={1} max={100} onChange={(v) => ctl.update({ maxPerUser: v ?? 25 })} error={ctl.errors.maxPerUser} />
          </div>
          <div className="mt-4">
            <Toggle label="Allow channel reminders" description="Lets members pick “here” so the reminder is posted in the channel instead of their DMs." checked={s.allowChannelReminders} onChange={(allowChannelReminders) => ctl.update({ allowChannelReminders })} />
          </div>
        </Card>
      )}
    </ModuleShell>
  );
}
