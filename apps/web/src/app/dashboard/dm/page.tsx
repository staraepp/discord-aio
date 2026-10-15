'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Send, X } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { Alert, Badge, Button, Card, Confirm, Empty, Field, PageHeader, Spinner, cx, formatDate } from '@/components/ui';
import { MessageBodyFields, bodyPreview, type MessageBody } from '@/components/message-body';
import { useToast } from '@/components/providers';

interface Member {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bot: boolean;
}

interface SentRow {
  id: string;
  userId: string | null;
  createdAt: string;
  meta: { embedId?: string | null; preview?: string | null; recipient?: string } | null;
}

function MemberRow({ m }: { m: Member }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <img src={m.avatarUrl} alt="" className="size-7 shrink-0 rounded-full" />
      <span className="min-w-0 truncate">
        <span className="font-medium text-text">{m.displayName}</span> <span className="text-muted">@{m.username}</span>
      </span>
      {m.bot && <Badge>Bot</Badge>}
    </span>
  );
}

/** Type a name (or paste a user ID) and pick from the matching members. */
function MemberSearch({ value, onChange }: { value: Member | null; onChange: (m: Member | null) => void }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const t = setTimeout(() => {
      api<Member[]>(`/api/members/search?q=${encodeURIComponent(query)}`)
        .then((r) => {
          setResults(r);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Search failed'));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <Field label="To">
        <div className="flex h-11 items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3">
          <MemberRow m={value} />
          <button type="button" onClick={() => onChange(null)} className="rounded-md p-1 text-muted hover:text-text" aria-label="Choose someone else">
            <X className="size-4" />
          </button>
        </div>
      </Field>
    );
  }

  const listId = `${id}-results`;
  return (
    <Field label="To" hint="Search by username or nickname, or paste a user ID." error={error ?? undefined} htmlFor={id}>
      <input
        id={id}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value.trim()) setResults(null);
        }}
        placeholder="Start typing a name"
        autoComplete="off"
        aria-controls={listId}
        className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-text placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:outline-none sm:h-10 sm:text-sm"
      />
      <div id={listId} aria-live="polite">
        {results && results.length === 0 && <p className="text-[13px] text-muted">Nobody in the server matches “{q.trim()}”.</p>}
        {results && results.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {results.map((m) => (
              <li key={m.id}>
                <button type="button" disabled={m.bot} onClick={() => onChange(m)} className={cx('flex min-h-11 w-full items-center px-3 py-2 text-left text-sm', m.bot ? 'cursor-not-allowed opacity-50' : 'hover:bg-panel-2')}>
                  <MemberRow m={m} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

export default function DirectMessagesPage() {
  const [to, setTo] = useState<Member | null>(null);
  const [body, setBody] = useState<MessageBody>({ embedId: null, content: '' });
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentRow[] | null>(null);
  const [embedNames, setEmbedNames] = useState<Record<string, string>>({});
  const { notify, fail } = useToast();

  const load = useCallback(() => {
    api<SentRow[]>('/api/dm').then(setSent).catch(fail);
    api<{ id: string; name: string }[]>('/api/embeds')
      .then((e) => setEmbedNames(Object.fromEntries(e.map((x) => [x.id, x.name]))))
      .catch(() => undefined);
  }, [fail]);
  useEffect(load, [load]);

  const ready = Boolean(to) && (body.embedId ? true : Boolean(body.content?.trim()));

  const send = async () => {
    if (!to) return;
    setSending(true);
    setError(null);
    try {
      const r = await api<{ message: string }>('/api/dm', { body: { userId: to.id, embedId: body.embedId || null, content: body.embedId ? null : body.content } });
      notify(r.message);
      setBody({ embedId: body.embedId, content: body.embedId ? null : '' });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.issues.map((i) => i.message)].join(' ') : 'Sending failed');
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Direct messages" description="Send a member a DM from the bot, as plain text or one of your saved embeds. Every DM is recorded in the audit log with who sent it." />
      <div className="space-y-6">
        <Card title="New DM">
          <div className="space-y-5">
            <MemberSearch value={to} onChange={setTo} />
            <MessageBodyFields value={body} onChange={setBody} />
            <p className="text-[13px] text-muted">
              Variables like <code>{'{user.name}'}</code> fill in with the recipient&apos;s details. Buttons that run bot actions are left out of DMs; link buttons still work.
            </p>
            {error && <Alert tone="bad">{error}</Alert>}
            <div className="flex justify-end">
              <Button variant="primary" disabled={!ready} loading={sending} onClick={() => setConfirming(true)}>
                <Send className="size-4" /> Send DM
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Recent DMs" description="The last 20 DMs sent through the bot.">
          {!sent ? (
            <Spinner />
          ) : sent.length === 0 ? (
            <Empty title="No DMs sent yet" />
          ) : (
            <ul className="divide-y divide-line">
              {sent.map((r) => (
                <li key={r.id} className="py-3">
                  <p className="text-sm">
                    <span className="font-medium">@{r.meta?.recipient ?? r.userId}</span> <span className="text-muted">· {formatDate(r.createdAt)}</span>
                  </p>
                  <p className="truncate text-[13px] text-muted">{bodyPreview({ embedId: r.meta?.embedId ?? null, content: r.meta?.preview ?? null }, r.meta?.embedId ? embedNames[r.meta.embedId] : undefined)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Confirm open={confirming} onClose={() => setConfirming(false)} onConfirm={send} busy={sending} title="Send this DM?" confirmLabel="Send">
        {to ? `@${to.username}` : 'This member'} will get it right away from the bot. DMs can&apos;t be unsent from here.
      </Confirm>
    </div>
  );
}
