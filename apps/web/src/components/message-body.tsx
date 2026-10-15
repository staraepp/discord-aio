'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Select, TextArea, cx } from './ui';
import { VariableHelp } from './template-editor';

export interface MessageBody {
  embedId: string | null;
  content: string | null;
}

/** A message is either one of the saved embeds or plain text with variables. */
export function MessageBodyFields({ value, onChange, error }: { value: MessageBody; onChange: (v: MessageBody) => void; error?: string }) {
  const [embeds, setEmbeds] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    api<{ id: string; name: string }[]>('/api/embeds')
      .then(setEmbeds)
      .catch(() => setEmbeds([]));
  }, []);
  const mode = value.embedId !== null ? 'embed' : 'text';
  const tab = (m: 'embed' | 'text', label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      onClick={() => onChange(m === 'embed' ? { embedId: embeds?.[0]?.id ?? '', content: null } : { embedId: null, content: value.content ?? '' })}
      className={cx('min-h-9 flex-1 rounded-md px-3 text-sm font-medium transition-colors', mode === m ? 'bg-panel-3 text-text' : 'text-muted hover:text-text')}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Message type" className="flex gap-1 rounded-lg border border-line bg-bg p-1">
        {tab('text', 'Text')}
        {tab('embed', 'Saved embed')}
      </div>
      {mode === 'embed' ? (
        embeds && embeds.length === 0 ? (
          <p className="text-[13px] text-muted">No saved embeds yet. Make one on the Embeds page first.</p>
        ) : (
          <Select label="Saved embed" hint="Edit its look on the Embeds page." value={value.embedId ?? ''} onChange={(embedId) => onChange({ embedId, content: null })} options={(embeds ?? []).map((e) => ({ value: e.id, label: e.name }))} error={error} />
        )
      ) : (
        <>
          <TextArea label="Message" hint="Up to 2000 characters. Mentions in here never ping anyone." rows={4} maxLength={2000} value={value.content ?? ''} onChange={(content) => onChange({ embedId: null, content })} error={error} />
          <VariableHelp />
        </>
      )}
    </div>
  );
}

export function bodyPreview(b: MessageBody, embedName?: string): string {
  if (b.embedId) return `Saved embed: ${embedName ?? 'unknown'}`;
  const t = (b.content ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 90 ? `${t.slice(0, 90)}…` : t || '(empty)';
}
