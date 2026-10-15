import type { AiPricingEntry, AiSettings } from '../settings/schemas';

/**
 * LOCAL cost ESTIMATES only. These never represent official Google/provider
 * billing and cannot guarantee that a provider-side overage is prevented.
 * Prices are admin-maintained settings (no hardcoded pricing in business logic).
 */

export type BudgetLevel = 'ok' | 'warn' | 'low_cost' | 'stopped';

export function estimateCostUsd(pricing: AiPricingEntry[], model: string, inputTokens: number, outputTokens: number): { usd: number; priced: boolean } {
  const p = pricing.find((e) => e.model === model);
  if (!p) return { usd: 0, priced: false };
  return { usd: (inputTokens / 1_000_000) * p.inputPerMTokUsd + (outputTokens / 1_000_000) * p.outputPerMTokUsd, priced: true };
}

export function budgetLevel(monthSpendUsd: number, budget: AiSettings['budget']): BudgetLevel {
  if (budget.hardStopEnabled && monthSpendUsd >= budget.hardStopUsd) return 'stopped';
  if (monthSpendUsd >= budget.lowCostAtUsd) return 'low_cost';
  if (monthSpendUsd >= budget.warnAtUsd) return 'warn';
  return 'ok';
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function dayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Choose the model for a request. Escalation to the harder-question model only
 * when configured, budget level is `ok`/`warn`, and the question is long/complex.
 * In `low_cost` mode only the everyday (cheapest) model is used.
 */
export function chooseModel(params: { chatModel: string; escalationModel?: string | null; level: BudgetLevel; escalation: AiSettings['escalation']; questionChars: number; hasImages: boolean; visionModel?: string | null }): string {
  if (params.hasImages && params.visionModel) return params.visionModel;
  if (params.level === 'low_cost') return params.chatModel;
  if (params.escalation.enabled && params.escalationModel && params.questionChars >= params.escalation.minQuestionChars) return params.escalationModel;
  return params.chatModel;
}
