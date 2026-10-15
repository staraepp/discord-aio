'use client';

import { useCallback, useEffect, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square, Trash2, Unplug, ListStart } from 'lucide-react';
import { api } from '@/lib/client';
import { Advanced, Alert, Badge, Button, Card, NumberInput, PageSkeleton, Select, Spinner, Tabs, TextInput, Toggle, formatDate } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { ChannelPicker, useChannelName } from '@/components/pickers';
import { useToast } from '@/components/providers';

interface MusicSettings {
  musicTextChannelId?: string;
  historyLogChannelId?: string;
  panelIntervalSec: number;
  consecutiveLimit: number;
  playlistImportCap: number;
  defaultVolume: number;
  allow247: boolean;
  ephemeralAcks: boolean;
  sources: { youtube: boolean; spotify: boolean; appleMusic: boolean };
  lyrics: { enabled: boolean; provider: 'lrclib'; termsAcknowledged: boolean };
  panel: { color: number; showArtwork: boolean; timelineHead: string; timelineFilled: string; timelineEmpty: string; footerText: string };
}

interface Entry {
  id: string;
  title: string;
  author: string;
  durationMs: number | null;
  requesterId: string;
  staffAdded: boolean;
  sourceName: string;
  substitutionNote: string | null;
  uri: string | null;
}
interface Session {
  id: string;
  voiceChannelId: string;
  kind: 'public' | 'temp';
  identitySlot: number | null;
  state: string;
  volume: number;
  loopMode: 'off' | 'track' | 'queue';
  is247: boolean;
  positionMs: number;
  current: Entry | null;
  pending: Entry[];
  history: Entry[];
}

function dur(ms: number | null): string {
  if (ms === null) return 'live';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function SortableRow({ entry, index, onRemove, onJump }: { entry: Entry; index: number; onRemove: () => void; onJump: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2 text-sm ${isDragging ? 'opacity-60' : ''}`}>
      <button type="button" className="cursor-grab touch-none text-muted" aria-label={`Reorder ${entry.title}`} {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <span className="w-6 text-right text-muted">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate">{entry.title}</p>
        <p className="truncate text-xs text-muted">
          {entry.author} · {dur(entry.durationMs)} · requested by <span className="font-mono">{entry.requesterId}</span>
          {entry.substitutionNote && <span className="text-warn"> · {entry.substitutionNote}</span>}
        </p>
      </div>
      <Button size="sm" variant="ghost" aria-label={`Play ${entry.title} next and skip`} onClick={onJump}>
        <ListStart className="size-4" />
      </Button>
      <Button size="sm" variant="ghost" aria-label={`Remove ${entry.title}`} onClick={onRemove}>
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

function SessionCard({ s, onChanged }: { s: Session; onChanged: () => void }) {
  const channelName = useChannelName();
  const { notify, fail } = useToast();
  const [pending, setPending] = useState(s.pending);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setPending(s.pending), [s.pending]);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const act = async (action: string, arg?: unknown) => {
    setBusy(action);
    try {
      const r = await api<{ message: string }>(`/api/music/sessions/${s.id}/action`, { body: { action, ...(arg !== undefined ? { arg } : {}) } });
      notify(r.message);
      onChanged();
    } catch (e) {
      fail(e);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = pending.findIndex((p) => p.id === e.active.id);
    const to = pending.findIndex((p) => p.id === e.over!.id);
    const next = arrayMove(pending, from, to);
    setPending(next);
    void act('reorder', next.map((p) => p.id));
  };

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {channelName(s.voiceChannelId)}
          <Badge tone={s.state === 'playing' ? 'good' : s.state === 'paused' ? 'warn' : 'neutral'}>{s.state}</Badge>
          {s.kind === 'temp' && <Badge tone="accent">Temp room</Badge>}
          {s.identitySlot && <Badge>Player #{s.identitySlot}</Badge>}
          {s.is247 && <Badge tone="accent">24/7</Badge>}
        </span>
      }
    >
      <div className="rounded-xl bg-panel-2 p-4">
        {s.current ? (
          <>
            <p className="text-xs text-muted uppercase">Now playing</p>
            <p className="font-medium">{s.current.title}</p>
            <p className="text-sm text-muted">
              {s.current.author} · {dur(s.positionMs)} / {dur(s.current.durationMs)} · requested by <span className="font-mono">{s.current.requesterId}</span>
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Nothing playing.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2" role="toolbar" aria-label="Playback controls">
          <Button size="sm" aria-label="Previous" loading={busy === 'previous'} onClick={() => act('previous')}>
            <SkipBack className="size-4" />
          </Button>
          {s.state === 'playing' ? (
            <Button size="sm" aria-label="Pause" loading={busy === 'pause'} onClick={() => act('pause')}>
              <Pause className="size-4" />
            </Button>
          ) : (
            <Button size="sm" aria-label="Resume" loading={busy === 'resume'} onClick={() => act('resume')}>
              <Play className="size-4" />
            </Button>
          )}
          <Button size="sm" aria-label="Skip" loading={busy === 'skip'} onClick={() => act('skip')}>
            <SkipForward className="size-4" />
          </Button>
          <Button size="sm" aria-label="Shuffle queue" loading={busy === 'shuffle'} onClick={() => act('shuffle')}>
            <Shuffle className="size-4" />
          </Button>
          <Button size="sm" aria-label={`Loop: ${s.loopMode}`} onClick={() => act('loop', s.loopMode === 'off' ? 'track' : s.loopMode === 'track' ? 'queue' : 'off')}>
            <Repeat className="size-4" /> {s.loopMode}
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Volume</span>
            <select className="h-8 rounded-lg border border-line bg-bg px-2" value={s.volume} onChange={(e) => act('volume', Number(e.target.value))} aria-label="Volume">
              {Array.from({ length: 21 }, (_, i) => i * 10).map((v) => (
                <option key={v} value={v}>
                  {v}%
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="danger" loading={busy === 'stop'} onClick={() => act('stop')}>
            <Square className="size-4" /> Stop & clear
          </Button>
          <Button size="sm" loading={busy === 'disconnect'} onClick={() => act('disconnect')}>
            <Unplug className="size-4" /> Disconnect (keep queue)
          </Button>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Up next ({pending.length})</p>
          {pending.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => act('clear')}>
              Clear queue
            </Button>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">The queue is empty.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pending.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-1.5">
                {pending.map((e, i) => (
                  <SortableRow key={e.id} entry={e} index={i} onRemove={() => act('remove_entry', e.id)} onJump={() => act('jump_entry', e.id)} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <p className="mt-2 text-xs text-muted">Drag to reorder (keyboard: focus the handle, press Space, use arrow keys). Staff changes bypass the five-in-a-row rule.</p>
      </div>
    </Card>
  );
}

function LiveRooms() {
  const [data, setData] = useState<{ sessions: Session[]; identities: { slot: number; label: string; online: boolean }[] } | null>(null);
  const { fail } = useToast();
  const load = useCallback(() => {
    api<{ sessions: Session[]; identities: { slot: number; label: string; online: boolean }[] }>('/api/music/sessions').then(setData).catch(fail);
  }, [fail]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);
  if (!data) return <PageSkeleton />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {data.identities.length === 0 && <Badge>No music players have connected yet</Badge>}
        {data.identities.map((i) => (
          <Badge key={i.slot} tone={i.online ? 'good' : 'neutral'}>
            Player #{i.slot} {i.label}: {i.online ? 'online' : 'offline'}
          </Badge>
        ))}
      </div>
      {data.sessions.length === 0 ? <p className="text-sm text-muted">No active or saved music rooms.</p> : data.sessions.map((s) => <SessionCard key={s.id} s={s} onChanged={load} />)}
    </div>
  );
}

function History() {
  const [items, setItems] = useState<{ id: string; title: string; author: string; requesterId: string; playedAt: string; sourceName: string; voiceChannelId: string }[] | null>(null);
  const [requester, setRequester] = useState('');
  const { fail } = useToast();
  const channelName = useChannelName();
  useEffect(() => {
    const q = /^\d{17,20}$/.test(requester) ? `?requester=${requester}` : '';
    api<{ items: NonNullable<typeof items> }>(`/api/music/history${q}`)
      .then((r) => setItems(r.items))
      .catch(fail);
  }, [requester, fail]);
  return (
    <Card title="Play history" description="The last 50 plays. Filter by requester ID.">
      <div className="mb-4 max-w-xs">
        <TextInput label="Requester ID" value={requester} onChange={setRequester} inputMode="numeric" />
      </div>
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">Nothing played yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.map((h) => (
            <li key={h.id} className="flex justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{h.title}</span>
                <span className="text-xs text-muted">
                  {h.author} · {h.sourceName} · #{channelName(h.voiceChannelId)} · <span className="font-mono">{h.requesterId}</span>
                </span>
              </span>
              <span className="text-xs whitespace-nowrap text-muted">{formatDate(h.playedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function MusicPage() {
  const ctl = useModuleSettings<MusicSettings>('music');
  const [tab, setTab] = useState<'rooms' | 'settings' | 'history'>('rooms');
  const s = ctl.draft;
  return (
    <ModuleShell title="Music" description="Up to three rooms at once (main bot + two optional music-only players). Top search result is played; staff can manage every queue." ctl={ctl}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'rooms', label: 'Live rooms' },
          { id: 'settings', label: 'Settings' },
          { id: 'history', label: 'History' },
        ]}
      />
      {tab === 'rooms' && <LiveRooms />}
      {tab === 'history' && <History />}
      {tab === 'settings' && s && (
        <>
          <Card title="Basics">
            <div className="grid gap-5 md:grid-cols-2">
              <ChannelPicker label="Music text channel" hint="Where Now Playing panels are posted. Defaults to the channel the command was used in." value={s.musicTextChannelId} onChange={(v) => ctl.update({ musicTextChannelId: v })} />
              <NumberInput label="Songs in a row per member" hint="Ordinary members can queue at most this many consecutive songs. Staff and temp-room queues are exempt." min={1} max={50} value={s.consecutiveLimit} onChange={(v) => ctl.update({ consecutiveLimit: v ?? 5 })} error={ctl.errors.consecutiveLimit} />
              <Select label="Default volume" value={String(s.defaultVolume)} onChange={(v) => ctl.update({ defaultVolume: Number(v) })} options={Array.from({ length: 21 }, (_, i) => ({ value: String(i * 10), label: `${i * 10}%` }))} />
              <NumberInput label="Panel refresh (seconds)" hint="How often the Now Playing progress bar updates (5–15)." min={5} max={15} value={s.panelIntervalSec} onChange={(v) => ctl.update({ panelIntervalSec: v ?? 10 })} error={ctl.errors.panelIntervalSec} />
            </div>
          </Card>
          <Card title="Sources" description="Spotify and Apple Music links are resolved to metadata and matched to a playable source. A link is not the audio itself.">
            <div className="grid gap-2 md:grid-cols-3">
              <Toggle label="YouTube" checked={s.sources.youtube} onChange={(v) => ctl.update({ sources: { ...s.sources, youtube: v } })} />
              <Toggle label="Spotify links" checked={s.sources.spotify} onChange={(v) => ctl.update({ sources: { ...s.sources, spotify: v } })} />
              <Toggle label="Apple Music links" checked={s.sources.appleMusic} onChange={(v) => ctl.update({ sources: { ...s.sources, appleMusic: v } })} />
            </div>
          </Card>
          <Card title="Lyrics" description="Synced lyrics follow the song in a separate message. Falls back to plain lyrics or a friendly notice.">
            <Toggle label="Enable lyrics" checked={s.lyrics.enabled} onChange={(v) => ctl.update({ lyrics: { ...s.lyrics, enabled: v } })} />
            <Toggle label="I reviewed the lyrics provider's terms (LRCLIB) for this server" checked={s.lyrics.termsAcknowledged} onChange={(v) => ctl.update({ lyrics: { ...s.lyrics, termsAcknowledged: v } })} />
            {s.lyrics.enabled && !s.lyrics.termsAcknowledged && <Alert tone="warn">Lyrics stay off until the terms are acknowledged.</Alert>}
          </Card>
          <Advanced>
            <div className="grid gap-5 md:grid-cols-2">
              <Toggle label="Allow 24/7 mode" description="Staff can keep a player connected in an empty room." checked={s.allow247} onChange={(v) => ctl.update({ allow247: v })} />
              <Toggle label="Private command replies" description="Acknowledge commands with ephemeral replies; the panel stays public." checked={s.ephemeralAcks} onChange={(v) => ctl.update({ ephemeralAcks: v })} />
              <NumberInput label="Playlist import cap" hint="Maximum tracks accepted from one playlist link (a fitting subset is added)." min={1} max={500} value={s.playlistImportCap} onChange={(v) => ctl.update({ playlistImportCap: v ?? 500 })} />
              <ChannelPicker label="Play history log channel" value={s.historyLogChannelId} onChange={(v) => ctl.update({ historyLogChannelId: v })} />
              <TextInput label="Timeline head" value={s.panel.timelineHead} onChange={(v) => ctl.update({ panel: { ...s.panel, timelineHead: v } })} maxLength={16} />
              <TextInput label="Panel footer" value={s.panel.footerText} onChange={(v) => ctl.update({ panel: { ...s.panel, footerText: v } })} maxLength={200} />
              <Toggle label="Show artwork" checked={s.panel.showArtwork} onChange={(v) => ctl.update({ panel: { ...s.panel, showArtwork: v } })} />
              <label className="flex items-center gap-3 text-sm">
                Panel color
                <input type="color" value={`#${s.panel.color.toString(16).padStart(6, '0')}`} onChange={(e) => ctl.update({ panel: { ...s.panel, color: parseInt(e.target.value.slice(1), 16) } })} className="h-9 w-14 rounded border border-line bg-bg" />
              </label>
            </div>
          </Advanced>
        </>
      )}
    </ModuleShell>
  );
}
