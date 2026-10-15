import { encryptSecret, last4 } from '@aio/core';
import { isAllowedBaseUrl } from '@aio/core/ai';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { credentialSchema, keyring, publicCredential } from '@/lib/ai';

const updateSchema = credentialSchema.omit({ provider: true }).extend({ apiKey: credentialSchema.shape.apiKey.optional() });

async function find(id: string, guildId: string) {
  const row = await db().aIProviderEncryptedCredential.findFirst({ where: { id, guildId } });
  if (!row) throw new HttpError(404, 'Credential not found');
  return row;
}

/** Update metadata; the key is replaced only if a new one is supplied (write-only). */
export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const row = await find(params.id, guildId);
  const input = await readJson(req, updateSchema);
  if (row.provider === 'openai_compatible' && (!input.baseUrl || !isAllowedBaseUrl(input.baseUrl))) throw new HttpError(422, 'Enter an https:// base URL.');
  const keyData = input.apiKey ? (() => {
    const ring = keyring();
    return { encryptedKey: encryptSecret(input.apiKey.trim(), ring), keyLast4: last4(input.apiKey.trim()), keyVersion: ring.current, lastTestOk: null, lastError: null };
  })() : {};
  const updated = await db().aIProviderEncryptedCredential.update({
    where: { id: row.id },
    data: {
      label: input.label,
      baseUrl: row.provider === 'openai_compatible' ? input.baseUrl! : null,
      enabled: input.enabled,
      chatModel: input.chatModel,
      escalationModel: input.escalationModel ?? null,
      visionModel: input.visionModel ?? null,
      extractionModel: input.extractionModel ?? null,
      ...keyData,
    },
  });
  await audit(session, { module: 'ai', action: input.apiKey ? 'provider.rotate_key' : 'provider.update', targetId: row.id, before: publicCredential(row), after: publicCredential(updated) });
  return publicCredential(updated);
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, guildId);
  await db().aIProviderEncryptedCredential.delete({ where: { id: row.id } });
  await audit(session, { module: 'ai', action: 'provider.delete', targetId: row.id, before: { provider: row.provider, label: row.label, keyLast4: row.keyLast4 } });
  return { ok: true };
});
