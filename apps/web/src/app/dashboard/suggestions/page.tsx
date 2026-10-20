'use client';

import { useState } from 'react';
import { Advanced, Alert, Card, NumberInput, TextInput, Toggle } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { ChannelPicker } from '@/components/pickers';

interface SuggestionSettings {
  channelId?: string;
  reactions: string[];
  postAsMember: boolean;
  cooldownSeconds: number;
}

const splitReactions = (text: string) => text.split(/\s+/).filter(Boolean);

/** Keeps the typed text (trailing space included) and only re-reads it when the saved list changes elsewhere. */
function ReactionsInput({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (reactions: string[]) => void;
  error?: string;
}) {
  const [text, setText] = useState(value.join(' '));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (splitReactions(text).join(' ') !== value.join(' ')) setText(value.join(' '));
  }
  return (
    <TextInput
      label="Vote reactions"
      hint="Up to 5, separated by spaces. Custom emoji work too, like <:yes:123…>."
      value={text}
      onChange={(next) => {
        setText(next);
        onChange(splitReactions(next));
      }}
      maxLength={350}
      error={error}
    />
  );
}

export default function SuggestionsPage() {
  const ctl = useModuleSettings<SuggestionSettings>('suggestions');
  const s = ctl.draft;
  return (
    <ModuleShell
      title="Suggestions"
      description="Members share ideas with /suggest or +suggest. Each one is posted in your suggestions channel with vote reactions under it, and their own message is cleaned up."
      ctl={ctl}
    >
      {s && (
        <>
          {ctl.data?.enabled && !s.channelId && (
            <Alert tone="warn" title="Pick a suggestions channel">
              Members get a "not set up yet" reply until you choose where suggestions go.
            </Alert>
          )}
          <Card title="Suggestions">
            <div className="grid gap-5 md:grid-cols-2">
              <ChannelPicker
                label="Suggestions channel"
                value={s.channelId}
                onChange={(channelId) => ctl.update({ channelId })}
                error={ctl.errors.channelId}
              />
              <ReactionsInput
                value={s.reactions}
                onChange={(reactions) => ctl.update({ reactions })}
                error={ctl.errors.reactions}
              />
            </div>
            <div className="mt-4">
              <Toggle
                label="Post with the member's name and picture"
                checked={s.postAsMember}
                onChange={(postAsMember) => ctl.update({ postAsMember })}
              />
              <p className="mt-1 text-sm text-muted">
                Needs the Manage Webhooks permission in that channel. Without it, the bot posts the suggestion
                itself with the member's name on top.
              </p>
            </div>
          </Card>
          <Advanced>
            <NumberInput
              label="Wait between suggestions (seconds)"
              hint="Per member, so one person can't flood the channel. 0 turns it off."
              value={s.cooldownSeconds}
              min={0}
              max={3600}
              onChange={(v) => ctl.update({ cooldownSeconds: v ?? 60 })}
              error={ctl.errors.cooldownSeconds}
            />
          </Advanced>
        </>
      )}
    </ModuleShell>
  );
}
