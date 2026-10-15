'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, KeyRound, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Advanced, Alert, Badge, Button, Card, Confirm, Modal, Select, Spinner, TextInput, Toggle, formatDate } from '@/components/ui';
import { useToast } from '@/components/providers';

type ProviderId = 'google' | 'openai' | 'anthropic' | 'openrouter' | 'openai_compatible';
interface Credential {
  id: string;
  provider: ProviderId;
  label: string;
  baseUrl: string | null;
  keyLast4: string;
  priority: number;
  enabled: boolean;
  chatModel: string;
  escalationModel: string | null;
  visionModel: string | null;
  extractionModel: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
}
interface Data {
  providers: { id: ProviderId; label: string; defaultModel: string; needsBaseUrl: boolean }[];
  credentials: Credential[];
  bootstrap: { googleEnvKeyConfigured: boolean; defaultModel: string; escalationModel: string | null };
  encryptionConfigured: boolean;
}
type Draft = Omit<Credential, 'id' | 'keyLast4' | 'priority' | 'lastTestAt' | 'lastTestOk' | 'lastError'> & { id?: string; apiKey: string };

export function ProvidersTab() {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Credential | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const { notify, fail } = useToast();
  const load = useCallback(() => api<Data>('/api/ai/providers').then(setData).catch(fail), [fail]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return <Spinner />;

  const reorder = async (i: number, d: -1 | 1) => {
    const ids = data.credentials.map((c) => c.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    try {
      await api('/api/ai/providers/reorder', { body: { ids } });
      void load();
    } catch (e) {
      fail(e);
    }
  };

  const save = async () => {
    if (!draft) return;
    try {
      const { id, apiKey, provider, ...rest } = draft;
      const body = { ...rest, ...(apiKey ? { apiKey } : {}), baseUrl: rest.baseUrl || null, escalationModel: rest.escalationModel || null, visionModel: rest.visionModel || null, extractionModel: rest.extractionModel || null };
      await api(id ? `/api/ai/providers/${id}` : '/api/ai/providers', { method: id ? 'PUT' : 'POST', body: id ? body : { ...body, provider } });
      notify(id ? 'Provider updated.' : 'Provider added. The key is encrypted and cannot be shown again.');
      setDraft(null);
      void load();
    } catch (e) {
      fail(e);
    }
  };

  const meta = (p: ProviderId) => data.providers.find((x) => x.id === p)!;

  return (
    <>
      {!data.encryptionConfigured && (
        <Alert tone="bad" title="Encryption key missing">
          Set <code>AI_ENCRYPTION_KEY</code> on the server (32 random bytes, base64) before adding provider keys. See README → Secure key setup.
        </Alert>
      )}
      <Card
        title="Providers (bring your own key)"
        description="Tried top to bottom. A backup is used only when the one above is unavailable (timeouts, outages, rate limits), never to get around a safety block or the budget stop."
        actions={
          <Button variant="primary" size="sm" disabled={!data.encryptionConfigured} onClick={() => setDraft({ provider: 'google', label: 'Google Gemini', baseUrl: null, apiKey: '', enabled: true, chatModel: 'gemini-3.5-flash-lite', escalationModel: 'gemini-3.8-flash', visionModel: null, extractionModel: null })}>
            <Plus className="size-4" /> Add provider
          </Button>
        }
      >
        {data.credentials.length === 0 && !data.bootstrap.googleEnvKeyConfigured ? (
          <p className="text-sm text-muted">No providers yet. Google Gemini is the recommended default.</p>
        ) : (
          <ol className="space-y-2">
            {data.credentials.map((c, i) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="text-muted">{i + 1}.</span> {c.label} <Badge>{meta(c.provider)?.label ?? c.provider}</Badge>
                    {!c.enabled && <Badge>disabled</Badge>}
                    {c.lastTestOk === true && <Badge tone="good">test passed</Badge>}
                    {c.lastTestOk === false && <Badge tone="bad">test failed</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    <KeyRound className="inline size-3" aria-hidden /> ••••{c.keyLast4} · {c.chatModel}
                    {c.escalationModel && ` → ${c.escalationModel}`}
                    {c.lastTestAt && ` · tested ${formatDate(c.lastTestAt)}`}
                  </p>
                  {c.lastError && <p className="text-xs text-bad">{c.lastError}</p>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => reorder(i, -1)}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === data.credentials.length - 1} onClick={() => reorder(i, 1)}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    loading={testing === c.id}
                    onClick={async () => {
                      setTesting(c.id);
                      try {
                        const r = await api<{ ok: boolean; message: string }>(`/api/ai/providers/${c.id}/test`, { method: 'POST' });
                        notify(r.message, r.ok ? 'good' : 'bad');
                        void load();
                      } catch (e) {
                        fail(e);
                      } finally {
                        setTesting(null);
                      }
                    }}
                  >
                    Test
                  </Button>
                  <Button size="sm" onClick={() => setDraft({ ...c, apiKey: '' })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${c.label}`} onClick={() => setDeleting(c)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
            {data.bootstrap.googleEnvKeyConfigured && (
              <li className="rounded-xl border border-dashed border-line p-3 text-sm">
                <p className="font-medium">
                  Last resort: <code>GOOGLE_API_KEY</code> from the server environment
                </p>
                <p className="text-xs text-muted">
                  {data.bootstrap.defaultModel}
                  {data.bootstrap.escalationModel && ` → ${data.bootstrap.escalationModel}`}. Managed in <code>.env</code>, not here.
                </p>
              </li>
            )}
          </ol>
        )}
      </Card>
      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? `Edit ${draft.label}` : 'Add provider'}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" disabled={!draft || (!draft.id && draft.apiKey.trim().length < 8) || !draft.chatModel.trim()} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            {!draft.id && (
              <Select
                label="Provider"
                value={draft.provider}
                onChange={(provider) => {
                  const m = meta(provider);
                  setDraft({ ...draft, provider, label: m.label, chatModel: m.defaultModel, escalationModel: provider === 'google' ? 'gemini-3.8-flash' : null });
                }}
                options={data.providers.map((p) => ({ value: p.id, label: p.label }))}
              />
            )}
            <TextInput label="Name" value={draft.label} onChange={(label) => setDraft({ ...draft, label })} maxLength={60} />
            <TextInput
              label={draft.id ? 'Replace API key (optional)' : 'API key'}
              hint="Stored encrypted on the server. It is never shown again or sent to your browser."
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(apiKey) => setDraft({ ...draft, apiKey })}
            />
            {meta(draft.provider).needsBaseUrl && <TextInput label="Base URL" hint="Must be https://" value={draft.baseUrl ?? ''} onChange={(baseUrl) => setDraft({ ...draft, baseUrl })} />}
            <TextInput label="Everyday model" hint={draft.provider === 'google' ? 'Recommended: gemini-3.5-flash-lite (inexpensive)' : undefined} value={draft.chatModel} onChange={(chatModel) => setDraft({ ...draft, chatModel })} />
            <Toggle label="Enabled" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
            <Advanced title="More models">
              <TextInput label="Harder-question model" hint={draft.provider === 'google' ? 'e.g. gemini-3.8-flash; used only when escalation is on and budget allows' : undefined} value={draft.escalationModel ?? ''} onChange={(v) => setDraft({ ...draft, escalationModel: v || null })} />
              <TextInput label="Image model" value={draft.visionModel ?? ''} onChange={(v) => setDraft({ ...draft, visionModel: v || null })} />
              <TextInput label="Memory-learning model" value={draft.extractionModel ?? ''} onChange={(v) => setDraft({ ...draft, extractionModel: v || null })} />
            </Advanced>
          </div>
        )}
      </Modal>
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.label ?? ''}?`}
        confirmLabel="Delete key"
        onConfirm={async () => {
          try {
            await api(`/api/ai/providers/${deleting!.id}`, { method: 'DELETE' });
            notify('Deleted.');
            void load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        The encrypted key is deleted from the database. Revoke it with the provider too if it may have leaked.
      </Confirm>
    </>
  );
}
