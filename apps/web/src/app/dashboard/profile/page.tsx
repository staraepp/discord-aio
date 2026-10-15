'use client';

import { useRef, useState } from 'react';
import { ImageUp, RotateCcw } from 'lucide-react';
import type { BotProfile, ReplyKey } from '@aio/core/customize';
import { api } from '@/lib/client';
import { Alert, Button, Card, NumberInput, PageHeader, PageSkeleton, TextArea, TextInput, Toggle } from '@/components/ui';
import { SaveBar } from '@/components/module';
import { useSettingsDoc } from '@/components/settings-doc';
import { useToast } from '@/components/providers';

interface Res {
  profile: BotProfile;
  replies: Record<ReplyKey, { label: string; vars: readonly string[]; text: string }>;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Resizes an image in the browser so uploads stay small (Discord re-encodes anyway). */
async function resizeToDataUri(file: File, maxW: number, maxH: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let uri = canvas.toDataURL('image/webp', 0.9);
  if (!uri.startsWith('data:image/webp')) uri = canvas.toDataURL('image/png');
  return uri;
}

function ImagePicker({ label, hint, maxW, maxH, onApply, onReset, busy, wide }: { label: string; hint: string; maxW: number; maxH: number; onApply: (uri: string) => void; onReset: () => void; busy: boolean; wide?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const { fail } = useToast();
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-[13px] text-muted">{hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className={wide ? 'grid h-20 w-36 place-items-center overflow-hidden rounded-lg border border-line bg-bg' : 'grid size-20 place-items-center overflow-hidden rounded-full border border-line bg-bg'}>
          {preview ? <img src={preview} alt={`New ${label.toLowerCase()} preview`} className="size-full object-cover" /> : <ImageUp className="size-5 text-muted" aria-hidden />}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          aria-label={`Choose an image for the ${label.toLowerCase()}`}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              setPreview(await resizeToDataUri(f, maxW, maxH));
            } catch {
              fail(new Error("That file couldn't be read as an image."));
            }
          }}
        />
        <Button size="sm" onClick={() => input.current?.click()}>
          Choose image
        </Button>
        <Button size="sm" variant="primary" disabled={!preview} loading={busy} onClick={() => preview && onApply(preview)}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset} disabled={busy}>
          <RotateCcw className="size-4" /> Use default
        </Button>
      </div>
    </div>
  );
}

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export default function ProfilePage() {
  const ctl = useSettingsDoc<BotProfile, Res>('/api/customize/profile', (r) => r.profile);
  const { notify, fail } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [mainText, setMainText] = useState<string | null>(null);
  const [musicText, setMusicText] = useState<string | null>(null);

  if (ctl.loadError) return <Alert tone="bad">{ctl.loadError}</Alert>;
  if (!ctl.draft || !ctl.res) return <PageSkeleton label="Loading bot profile" />;
  const d = ctl.draft;
  const catalog = ctl.res.replies;

  const appearance = async (key: string, body: Record<string, string | null>) => {
    setBusy(key);
    try {
      const r = await api<{ message: string }>('/api/customize/appearance', { body });
      notify(r.message);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 pb-24">
      <PageHeader title="Bot profile" description="How the bot looks and sounds in this server. None of this changes the bot anywhere else." />

      <Card title="Look in this server" description="Server-only name, picture, banner and bio. Changes apply right away.">
        <div className="grid gap-6 lg:grid-cols-2">
          <TextInput label="Nickname" hint="Leave empty to use the bot's normal name. Saved with the button at the bottom." value={d.nickname ?? ''} maxLength={32} onChange={(v) => ctl.setDraft({ ...d, nickname: v.trim() ? v : null })} />
          <div className="space-y-2">
            <TextArea label="About me" hint="Up to 190 characters. Shown on the bot's profile in this server." value={bio} maxLength={190} rows={3} onChange={setBio} />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={busy === 'bio'} disabled={!bio.trim()} onClick={() => appearance('bio', { bio })}>
                Apply bio
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === 'bio'} onClick={() => appearance('bio', { bio: null })}>
                <RotateCcw className="size-4" /> Use default
              </Button>
            </div>
          </div>
          <ImagePicker label="Avatar" hint="Square images work best. Animated GIFs become still images here." maxW={512} maxH={512} busy={busy === 'avatar'} onApply={(uri) => appearance('avatar', { avatar: uri })} onReset={() => appearance('avatar', { avatar: null })} />
          <ImagePicker wide label="Banner" hint="A wide image, about 3:1." maxW={960} maxH={540} busy={busy === 'banner'} onApply={(uri) => appearance('banner', { banner: uri })} onReset={() => appearance('banner', { banner: null })} />
        </div>
      </Card>

      <Card title="Reply color" description="Used for the bot's own embeds, like the verification check and new tickets. Saved embeds and the music panel keep their own colors.">
        <div className="flex flex-wrap items-end gap-4">
          <Toggle label="Use the default colors" checked={d.replyColor === null} onChange={(on) => ctl.setDraft({ ...d, replyColor: on ? null : 0x5865f2 })} />
          {d.replyColor !== null && (
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input type="color" value={hex(d.replyColor)} onChange={(e) => ctl.setDraft({ ...d, replyColor: parseInt(e.target.value.slice(1), 16) })} className="size-10 cursor-pointer rounded-lg border border-line bg-bg p-1" />
              <span className="font-mono text-muted">{hex(d.replyColor)}</span>
            </label>
          )}
        </div>
      </Card>

      <Card title="Status lines" description="The custom status under the bot's name. A random line is picked every few minutes, never the same one twice in a row.">
        <div className="space-y-4">
          <Toggle label="Include the built-in lines" description="Turn off to only show your own." checked={d.statuses.useBuiltIn} onChange={(useBuiltIn) => ctl.setDraft({ ...d, statuses: { ...d.statuses, useBuiltIn } })} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TextArea
              label="Main bot"
              hint="One per line, up to 60 characters each."
              rows={6}
              value={mainText ?? d.statuses.main.join('\n')}
              onChange={(v) => {
                setMainText(v);
                ctl.setDraft({ ...d, statuses: { ...d.statuses, main: linesToList(v) } });
              }}
              placeholder={'touching grass later\nbeing perceived 😨'}
            />
            <TextArea
              label="Music bots"
              hint="One per line. Used by every music player."
              rows={6}
              value={musicText ?? d.statuses.music.join('\n')}
              onChange={(v) => {
                setMusicText(v);
                ctl.setDraft({ ...d, statuses: { ...d.statuses, music: linesToList(v) } });
              }}
              placeholder={'sad songs at 3am 🥺'}
            />
          </div>
          <div className="max-w-xs">
            <NumberInput label="Change every (minutes)" value={d.statuses.intervalMinutes} min={1} max={60} onChange={(v) => ctl.setDraft({ ...d, statuses: { ...d.statuses, intervalMinutes: v ?? 4 } })} error={ctl.errors['statuses.intervalMinutes']} />
          </div>
          {Object.keys(ctl.errors).some((k) => k.startsWith('statuses.main') || k.startsWith('statuses.music')) && <Alert tone="bad">Each status line can be at most 60 characters.</Alert>}
        </div>
      </Card>

      <Card title="Bot replies" description="Reword the bot's standard replies. Leave a box empty to keep the default. Words in {braces} are filled in by the bot.">
        <div className="grid gap-5 lg:grid-cols-2">
          {(Object.keys(catalog) as ReplyKey[]).map((key) => (
            <TextArea
              key={key}
              label={catalog[key].label}
              hint={catalog[key].vars.length ? `Can use ${catalog[key].vars.map((v) => `{${v}}`).join(', ')}` : undefined}
              rows={2}
              maxLength={500}
              placeholder={catalog[key].text}
              value={d.replies[key] ?? ''}
              onChange={(v) => {
                const replies = { ...d.replies };
                if (v.trim()) replies[key] = v;
                else delete replies[key];
                ctl.setDraft({ ...d, replies });
              }}
              error={ctl.errors[`replies.${key}`]}
            />
          ))}
        </div>
      </Card>
      <SaveBar dirty={ctl.dirty} saving={ctl.saving} onSave={ctl.save} onReset={() => { ctl.reset(); setMainText(null); setMusicText(null); }} errorCount={Object.keys(ctl.errors).length} />
    </div>
  );
}
