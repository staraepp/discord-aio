import { decryptSecret } from '@aio/core';
import { adapterFor, estimateCostUsd, ProviderError, recordAttempts, type ProviderId } from '@aio/core/ai';
import { adminRoute, HttpError } from '@/lib/api';
import { db } from '@/lib/server';
import { budgetState, keyring } from '@/lib/ai';
import { limit } from '@/lib/ratelimit';

/** Minimal live test call. Respects the hard budget stop and records usage like any other call. */
export const POST = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  limit('aiTest', session.userId);
  const row = await db().aIProviderEncryptedCredential.findFirst({ where: { id: params.id, guildId } });
  if (!row) throw new HttpError(404, 'Credential not found');
  const budget = await budgetState(guildId);
  if (budget.level === 'stopped') throw new HttpError(409, 'The monthly hard budget stop is active. Raise the limit or wait for next month before testing.');
  let apiKey: string;
  try {
    apiKey = decryptSecret(row.encryptedKey, keyring());
  } catch {
    throw new HttpError(409, 'This key cannot be decrypted with the current AI_ENCRYPTION_KEY. Re-enter the key.');
  }
  const started = Date.now();
  try {
    const res = await adapterFor(row.provider as ProviderId, row.baseUrl).chat({ model: row.chatModel, system: 'Reply with the single word OK.', turns: [{ role: 'user', text: 'Connection test' }], maxOutputTokens: 5, timeoutMs: 15_000 }, apiKey);
    const cost = estimateCostUsd(budget.pricing, row.chatModel, res.inputTokens, res.outputTokens);
    await recordAttempts(db(), guildId, 'test', [{ credentialId: row.id, provider: row.provider, model: row.chatModel, ok: true, inputTokens: res.inputTokens, outputTokens: res.outputTokens, estimatedCostUsd: cost.usd, latencyMs: Date.now() - started }]);
    await db().aIProviderEncryptedCredential.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestOk: true, lastError: null } });
    return { ok: true, message: `Connected. ${row.chatModel} replied in ${Date.now() - started} ms.`, priced: cost.priced };
  } catch (err) {
    const kind = err instanceof ProviderError ? err.kind : 'network';
    const message = err instanceof ProviderError ? err.message : 'Could not reach the provider.';
    await recordAttempts(db(), guildId, 'test', [{ credentialId: row.id, provider: row.provider, model: row.chatModel, ok: false, errorKind: kind, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: Date.now() - started }]);
    await db().aIProviderEncryptedCredential.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestOk: false, lastError: `${kind}: ${message}`.slice(0, 300) } });
    return { ok: false, message: `${kind === 'auth' ? 'The key was rejected.' : message} (${kind})` };
  }
});
