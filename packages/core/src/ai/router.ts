import type { AIProviderEncryptedCredential, Db } from '@aio/db';
import { decryptSecret, type EncryptionKeyring } from '../crypto/index';
import { adapterFor, isProviderId, ProviderError, type ChatRequest, type ChatResponse, type ProviderAdapter, type ProviderId } from './providers';
import { budgetLevel, chooseModel, estimateCostUsd, monthStart, type BudgetLevel } from './budget';
import type { AiSettings } from '../settings/schemas';

/**
 * Priority-ordered provider fallback. Failover happens only on real
 * availability errors (timeout/rate limit/server/network/auth). A safety block
 * or a hard budget stop NEVER falls through to a backup credential.
 */

export interface CredentialLike {
  id: string;
  provider: string;
  baseUrl: string | null;
  priority: number;
  enabled: boolean;
  chatModel: string;
  escalationModel: string | null;
  visionModel: string | null;
  label: string;
}

export interface AttemptRecord {
  credentialId: string;
  provider: string;
  model: string;
  ok: boolean;
  errorKind?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export type RouteResult =
  | { ok: true; response: ChatResponse; used: CredentialLike; model: string; attempts: AttemptRecord[] }
  | { ok: false; reason: 'budget_stopped' | 'no_credentials' | 'safety' | 'all_failed' | 'bad_request'; message: string; attempts: AttemptRecord[] };

export interface RouteDeps {
  getKey: (cred: CredentialLike) => string;
  adapter: (provider: ProviderId, baseUrl: string | null) => ProviderAdapter;
  now?: () => number;
}

export async function routeChat(params: {
  credentials: CredentialLike[];
  request: Omit<ChatRequest, 'model'>;
  settings: AiSettings;
  monthSpendUsd: number;
  questionChars: number;
  hasImages: boolean;
  deps: RouteDeps;
}): Promise<RouteResult> {
  const level: BudgetLevel = budgetLevel(params.monthSpendUsd, params.settings.budget);
  const attempts: AttemptRecord[] = [];
  if (level === 'stopped') {
    return { ok: false, reason: 'budget_stopped', message: 'The AI helper has reached its monthly spending limit set by the server admins.', attempts };
  }
  const ordered = params.credentials.filter((c) => c.enabled && isProviderId(c.provider)).sort((a, b) => a.priority - b.priority);
  if (ordered.length === 0) return { ok: false, reason: 'no_credentials', message: 'The AI helper is not configured yet.', attempts };
  const now = params.deps.now ?? Date.now;

  for (const cred of ordered) {
    const model = chooseModel({
      chatModel: cred.chatModel,
      escalationModel: cred.escalationModel,
      visionModel: cred.visionModel,
      level,
      escalation: params.settings.escalation,
      questionChars: params.questionChars,
      hasImages: params.hasImages,
    });
    const started = now();
    try {
      const adapter = params.deps.adapter(cred.provider as ProviderId, cred.baseUrl);
      const response = await adapter.chat({ ...params.request, model }, params.deps.getKey(cred));
      const cost = estimateCostUsd(params.settings.pricing, model, response.inputTokens, response.outputTokens).usd;
      attempts.push({ credentialId: cred.id, provider: cred.provider, model, ok: true, latencyMs: now() - started, inputTokens: response.inputTokens, outputTokens: response.outputTokens, estimatedCostUsd: cost });
      return { ok: true, response, used: cred, model, attempts };
    } catch (err) {
      const pe = err instanceof ProviderError ? err : new ProviderError('network', 'Unexpected provider failure');
      attempts.push({ credentialId: cred.id, provider: cred.provider, model, ok: false, errorKind: pe.kind, latencyMs: now() - started, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
      if (pe.kind === 'safety') return { ok: false, reason: 'safety', message: "I can't help with that request.", attempts };
      if (!pe.retryable) return { ok: false, reason: 'bad_request', message: 'The AI provider rejected the request.', attempts };
    }
  }
  // Usually the provider's request quota (common on free tiers), so say that rather than "unavailable".
  const quota = attempts.length > 0 && attempts.every((a) => a.errorKind === 'rate_limit');
  return {
    ok: false,
    reason: 'all_failed',
    message: quota ? "I've hit the AI provider's request limit for now 😔 Try again in a little while." : 'The AI helper is temporarily unavailable. Please try again in a bit.',
    attempts,
  };
}

export async function monthSpend(db: Db, guildId: string, now = new Date()): Promise<number> {
  const agg = await db.aIUsageLedger.aggregate({ where: { guildId, createdAt: { gte: monthStart(now) } }, _sum: { estimatedCostUsd: true } });
  return Number(agg._sum.estimatedCostUsd ?? 0);
}

export async function recordAttempts(db: Db, guildId: string, purpose: string, attempts: AttemptRecord[]): Promise<void> {
  if (attempts.length === 0) return;
  await db.aIUsageLedger.createMany({
    data: attempts.map((a) => ({
      guildId,
      credentialId: a.credentialId,
      provider: a.provider,
      model: a.model,
      purpose,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      estimatedCostUsd: a.estimatedCostUsd,
      success: a.ok,
      errorCode: a.errorKind ?? null,
      latencyMs: a.latencyMs,
    })),
  });
}

/** Default deps: decrypt with the server-only keyring; bootstrap env key for the synthetic "env" credential. */
export function defaultRouteDeps(keyring: EncryptionKeyring | null, encrypted: Map<string, string>, bootstrapKey?: string): RouteDeps {
  return {
    getKey: (cred) => {
      if (cred.id === 'env-google' && bootstrapKey) return bootstrapKey;
      const payload = encrypted.get(cred.id);
      if (!payload || !keyring) throw new ProviderError('auth', 'Credential cannot be decrypted (AI_ENCRYPTION_KEY missing or rotated)');
      return decryptSecret(payload, keyring);
    },
    adapter: (provider, baseUrl) => adapterFor(provider, baseUrl),
  };
}

/** Loads credentials in priority order; the optional GOOGLE_API_KEY bootstrap acts as the lowest-priority Gemini entry. */
export async function loadCredentials(db: Db, guildId: string, env: { GOOGLE_API_KEY?: string; AI_DEFAULT_MODEL: string; AI_ESCALATION_MODEL?: string }): Promise<{ credentials: CredentialLike[]; encrypted: Map<string, string> }> {
  const rows: AIProviderEncryptedCredential[] = await db.aIProviderEncryptedCredential.findMany({ where: { guildId }, orderBy: { priority: 'asc' } });
  const credentials: CredentialLike[] = rows.map((r) => ({ ...r }));
  const encrypted = new Map(rows.map((r) => [r.id, r.encryptedKey]));
  if (env.GOOGLE_API_KEY) {
    credentials.push({
      id: 'env-google',
      provider: 'google',
      baseUrl: null,
      priority: 10_000,
      enabled: true,
      chatModel: env.AI_DEFAULT_MODEL,
      escalationModel: env.AI_ESCALATION_MODEL ?? null,
      visionModel: null,
      label: 'GOOGLE_API_KEY (environment)',
    });
  }
  return { credentials, encrypted };
}
