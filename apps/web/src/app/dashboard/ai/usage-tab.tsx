'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Alert, Badge, Button, Card, NumberInput, Spinner, Stat, TextInput, Toggle, formatDate } from '@/components/ui';
import { useToast } from '@/components/providers';
import type { AiSettings } from './types';

interface Usage {
  budget: { spent: number; level: 'ok' | 'warn' | 'low_cost' | 'stopped' };
  unpricedModels: string[];
  byModel: { provider: string; model: string; purpose: string; calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number }[];
  daily: { day: string; estimatedCostUsd: number; calls: number }[];
  recent: { id: string; model: string; purpose: string; success: boolean; errorCode: string | null; estimatedCostUsd: number; createdAt: string; latencyMs: number | null }[];
}

const LEVEL = {
  ok: { tone: 'good' as const, text: 'Normal' },
  warn: { tone: 'warn' as const, text: 'Warning threshold reached' },
  low_cost: { tone: 'warn' as const, text: 'Low-cost mode (cheapest model only)' },
  stopped: { tone: 'bad' as const, text: 'Hard stop: AI answers paused' },
};

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export function UsageTab({ s, update, errors }: { s: AiSettings; update: (p: Partial<AiSettings>) => void; errors: Record<string, string> }) {
  const [u, setU] = useState<Usage | null>(null);
  const { fail } = useToast();
  useEffect(() => {
    api<Usage>('/api/ai/usage').then(setU).catch(fail);
  }, [fail]);
  const b = s.budget;
  const max = Math.max(0.0001, ...(u?.daily.map((d) => d.estimatedCostUsd) ?? [0]));
  return (
    <>
      <Alert tone="info" title="These are local estimates, not your bill">
        Costs are estimated from token counts and the prices you enter below. Check real usage and credits in Google Cloud Billing. The Google AI Pro monthly credit only applies if it is activated on the billing account of the project that owns your API key.
      </Alert>
      {!u ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Estimated this month" value={usd(u.budget.spent)} hint={`Target ${usd(b.monthlyTargetUsd)}`} />
            <Stat label="Budget state" value={<Badge tone={LEVEL[u.budget.level].tone}>{LEVEL[u.budget.level].text}</Badge>} />
            <Stat label="Calls this month" value={u.byModel.reduce((n, m) => n + m.calls, 0)} />
          </div>
          {u.unpricedModels.length > 0 && <Alert tone="warn" title="Some models have no price set">{u.unpricedModels.join(', ')} are counted as $0 until you add prices below.</Alert>}
          {u.daily.length > 0 && (
            <Card title="Daily estimate">
              <div className="flex h-32 items-end gap-1" role="img" aria-label="Daily estimated spend chart">
                {u.daily.map((d) => (
                  <div key={d.day} className="flex-1 rounded-t bg-accent/70" style={{ height: `${Math.max(2, (d.estimatedCostUsd / max) * 100)}%` }} title={`${d.day}: ${usd(d.estimatedCostUsd)} · ${d.calls} calls`} />
                ))}
              </div>
            </Card>
          )}
          <Card title="By model">
            {u.byModel.length === 0 ? (
              <p className="text-sm text-muted">No calls this month.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted uppercase">
                  <tr>
                    <th className="py-2">Model</th>
                    <th>Purpose</th>
                    <th>Calls</th>
                    <th>Tokens in/out</th>
                    <th>Estimate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {u.byModel.map((m) => (
                    <tr key={`${m.model}-${m.purpose}`}>
                      <td className="py-2">{m.model}</td>
                      <td>{m.purpose}</td>
                      <td>{m.calls}</td>
                      <td>
                        {m.inputTokens.toLocaleString()} / {m.outputTokens.toLocaleString()}
                      </td>
                      <td>{usd(m.estimatedCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Recent calls">
            <ul className="divide-y divide-line text-sm">
              {u.recent.map((r) => (
                <li key={r.id} className="flex justify-between gap-3 py-1.5">
                  <span>
                    {r.model} · {r.purpose} {!r.success && <Badge tone="bad">{r.errorCode ?? 'failed'}</Badge>}
                  </span>
                  <span className="text-xs text-muted">
                    {usd(r.estimatedCostUsd)} · {r.latencyMs ?? '?'} ms · {formatDate(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      <Card title="Budget" description="Thresholds use the local estimate. With the hard stop on, the AI pauses at the limit, and backup providers cannot bypass it.">
        <div className="grid gap-4 md:grid-cols-4">
          <NumberInput label="Monthly target ($)" min={0} step={0.5} value={b.monthlyTargetUsd} onChange={(v) => update({ budget: { ...b, monthlyTargetUsd: v ?? 0 } })} />
          <NumberInput label="Warn at ($)" min={0} step={0.5} value={b.warnAtUsd} onChange={(v) => update({ budget: { ...b, warnAtUsd: v ?? 0 } })} />
          <NumberInput label="Cheapest model only at ($)" min={0} step={0.5} value={b.lowCostAtUsd} onChange={(v) => update({ budget: { ...b, lowCostAtUsd: v ?? 0 } })} />
          <NumberInput label="Hard stop at ($)" min={0} step={0.5} value={b.hardStopUsd} onChange={(v) => update({ budget: { ...b, hardStopUsd: v ?? 0 } })} error={errors['budget.hardStopUsd']} />
        </div>
        <div className="mt-3">
          <Toggle label="Enable hard stop" checked={b.hardStopEnabled} onChange={(hardStopEnabled) => update({ budget: { ...b, hardStopEnabled } })} />
        </div>
      </Card>
      <Card title="Prices used for estimates" description="Per million tokens, in USD. Copy them from the provider's pricing page and note the date, since prices change.">
        <div className="space-y-2">
          {s.pricing.map((p, i) => (
            <div key={i} className="grid items-end gap-2 md:grid-cols-[1fr_9rem_9rem_1fr_auto]">
              <TextInput label="Model" value={p.model} onChange={(model) => update({ pricing: s.pricing.map((x, j) => (j === i ? { ...x, model } : x)) })} />
              <NumberInput label="Input $/M" min={0} step={0.01} value={p.inputPerMTokUsd} onChange={(v) => update({ pricing: s.pricing.map((x, j) => (j === i ? { ...x, inputPerMTokUsd: v ?? 0 } : x)) })} />
              <NumberInput label="Output $/M" min={0} step={0.01} value={p.outputPerMTokUsd} onChange={(v) => update({ pricing: s.pricing.map((x, j) => (j === i ? { ...x, outputPerMTokUsd: v ?? 0 } : x)) })} />
              <TextInput label="Source / date" value={p.note} onChange={(note) => update({ pricing: s.pricing.map((x, j) => (j === i ? { ...x, note } : x)) })} maxLength={200} />
              <Button variant="ghost" aria-label="Remove price" onClick={() => update({ pricing: s.pricing.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button size="sm" disabled={s.pricing.length >= 50} onClick={() => update({ pricing: [...s.pricing, { model: 'gemini-3.5-flash-lite', inputPerMTokUsd: 0, outputPerMTokUsd: 0, note: '' }] })}>
            <Plus className="size-4" /> Add model price
          </Button>
        </div>
      </Card>
    </>
  );
}
