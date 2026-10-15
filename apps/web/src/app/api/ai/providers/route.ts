import { encryptSecret, last4 } from '@aio/core';
import { isAllowedBaseUrl, PROVIDERS } from '@aio/core/ai';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db, env } from '@/lib/server';
import { credentialSchema, keyring, publicCredential } from '@/lib/ai';

export const GET = adminRoute(async ({ guildId }) => {
  const rows = await db().aIProviderEncryptedCredential.findMany({ where: { guildId }, orderBy: { priority: 'asc' } });
  return {
    providers: PROVIDERS,
    credentials: rows.map(publicCredential),
    bootstrap: { googleEnvKeyConfigured: Boolean(env().GOOGLE_API_KEY), defaultModel: env().AI_DEFAULT_MODEL, escalationModel: env().AI_ESCALATION_MODEL ?? null },
    encryptionConfigured: Boolean(env().AI_ENCRYPTION_KEY),
  };
});

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, credentialSchema);
  if (input.provider === 'openai_compatible' && (!input.baseUrl || !isAllowedBaseUrl(input.baseUrl))) throw new HttpError(422, 'Enter an https:// base URL.');
  const ring = keyring();
  const count = await db().aIProviderEncryptedCredential.count({ where: { guildId } });
  if (count >= 10) throw new HttpError(422, 'At most 10 provider credentials.');
  const row = await db().aIProviderEncryptedCredential.create({
    data: {
      guildId,
      provider: input.provider,
      label: input.label,
      baseUrl: input.provider === 'openai_compatible' ? input.baseUrl! : null,
      encryptedKey: encryptSecret(input.apiKey.trim(), ring),
      keyLast4: last4(input.apiKey.trim()),
      keyVersion: ring.current,
      priority: count,
      enabled: input.enabled,
      chatModel: input.chatModel,
      escalationModel: input.escalationModel ?? null,
      visionModel: input.visionModel ?? null,
      extractionModel: input.extractionModel ?? null,
    },
  });
  await audit(session, { module: 'ai', action: 'provider.add', targetId: row.id, after: { provider: row.provider, label: row.label, keyLast4: row.keyLast4, chatModel: row.chatModel } });
  return publicCredential(row);
});
