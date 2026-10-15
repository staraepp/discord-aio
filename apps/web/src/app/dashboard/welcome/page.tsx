'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MessageTemplate } from '@aio/discord-ui';
import { api } from '@/lib/client';
import { Card, Select, TextArea, Toggle } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { ChannelPicker } from '@/components/pickers';
import { TemplatePreview } from '@/components/discord-preview';
import { VariableHelp } from '@/components/template-editor';

interface WelcomeSettings {
  welcomeEnabled: boolean;
  welcomeChannelId?: string;
  welcomeEmbedId?: string;
  welcomeContent: string;
  goodbyeEnabled: boolean;
  goodbyeChannelId?: string;
  goodbyeEmbedId?: string;
  goodbyeContent: string;
}

type Saved = { id: string; name: string; template: MessageTemplate };

/** Same composition the bot uses: saved embed + the module's plain content. */
function compose(content: string, saved: MessageTemplate | undefined): MessageTemplate {
  const c = content.trim();
  if (!saved) return { content: c || '(empty message, nothing will be sent)', embeds: [], components: [] };
  return { ...saved, content: c || saved.content, components: [] };
}

function Greeting({ kind, s, update, embeds }: { kind: 'welcome' | 'goodbye'; s: WelcomeSettings; update: (p: Partial<WelcomeSettings>) => void; embeds: Saved[] }) {
  const enabled = kind === 'welcome' ? s.welcomeEnabled : s.goodbyeEnabled;
  const channel = kind === 'welcome' ? s.welcomeChannelId : s.goodbyeChannelId;
  const embedId = kind === 'welcome' ? s.welcomeEmbedId : s.goodbyeEmbedId;
  const content = kind === 'welcome' ? s.welcomeContent : s.goodbyeContent;
  const k = (name: string) => `${kind}${name}` as keyof WelcomeSettings;
  return (
    <Card title={kind === 'welcome' ? 'Welcome message' : 'Goodbye message'} description={kind === 'welcome' ? 'Sent when someone joins.' : 'Sent when someone leaves. Tip: use {user.name} here, since {user} would ping someone who already left.'}>
      <Toggle label={`Send ${kind} messages`} checked={enabled} onChange={(v) => update({ [k('Enabled')]: v })} />
      {enabled && (
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          <div className="space-y-4">
            <ChannelPicker label="Channel" value={channel} onChange={(v) => update({ [k('ChannelId')]: v })} />
            <TextArea label="Message text" value={content} onChange={(v) => update({ [k('Content')]: v })} maxLength={2000} rows={3} />
            <Select
              label="Saved embed (optional)"
              hint="Design embeds on the Embeds page."
              value={embedId ?? ''}
              onChange={(v) => update({ [k('EmbedId')]: v || undefined })}
              options={[{ value: '', label: 'No embed' }, ...embeds.map((e) => ({ value: e.id, label: e.name }))]}
            />
            <p className="text-xs text-muted">
              <Link href="/dashboard/embeds" className="text-accent underline">
                Open the embed builder
              </Link>
            </p>
            <VariableHelp />
          </div>
          <div>
            <p className="mb-2 text-xs text-muted">Preview</p>
            <TemplatePreview template={compose(content, embeds.find((e) => e.id === embedId)?.template)} />
          </div>
        </div>
      )}
    </Card>
  );
}

export default function WelcomePage() {
  const ctl = useModuleSettings<WelcomeSettings>('welcome');
  const [embeds, setEmbeds] = useState<Saved[]>([]);
  useEffect(() => {
    api<Saved[]>('/api/embeds').then(setEmbeds).catch(() => undefined);
  }, []);
  const s = ctl.draft;
  return (
    <ModuleShell title="Welcome & goodbye" description="Greet new members and say goodbye using your saved embeds and safe variables." ctl={ctl}>
      {s && (
        <>
          <Greeting kind="welcome" s={s} update={ctl.update} embeds={embeds} />
          <Greeting kind="goodbye" s={s} update={ctl.update} embeds={embeds} />
        </>
      )}
    </ModuleShell>
  );
}
