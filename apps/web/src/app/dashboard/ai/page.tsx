'use client';

import { useState } from 'react';
import { Tabs } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import type { AiSettings } from './types';
import { SettingsTab } from './settings-tab';
import { ContextTab } from './context-tab';
import { MemoryTab } from './memory-tab';
import { ProvidersTab } from './providers-tab';
import { UsageTab } from './usage-tab';
import { TestTab } from './test-tab';

type Tab = 'settings' | 'context' | 'memory' | 'providers' | 'usage' | 'test';

export default function AiPage() {
  const ctl = useModuleSettings<AiSettings>('ai');
  const [tab, setTab] = useState<Tab>('settings');
  const s = ctl.draft;
  return (
    <ModuleShell
      title="AI helper"
      description="Answers questions using only the channels you allow, cites its sources, and only speaks in its own channel. It is a helper and never moderates."
      ctl={ctl}
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'settings', label: 'Settings' },
          { id: 'context', label: 'Context' },
          { id: 'memory', label: 'Memory' },
          { id: 'providers', label: 'Providers' },
          { id: 'usage', label: 'Usage & budget' },
          { id: 'test', label: 'Test' },
        ]}
      />
      {s && tab === 'settings' && <SettingsTab s={s} update={ctl.update} errors={ctl.errors} />}
      {s && tab === 'context' && <ContextTab acknowledged={s.indexingNoticeAcknowledged} onAcknowledge={() => ctl.update({ indexingNoticeAcknowledged: true })} />}
      {s && tab === 'memory' && <MemoryTab s={s} update={ctl.update} />}
      {tab === 'providers' && <ProvidersTab />}
      {s && tab === 'usage' && <UsageTab s={s} update={ctl.update} errors={ctl.errors} />}
      {tab === 'test' && <TestTab />}
    </ModuleShell>
  );
}
