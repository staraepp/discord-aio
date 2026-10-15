import 'server-only';
import { z } from 'zod';
import { keyringFromEnv, type EncryptionKeyring } from '@aio/core';
import { budgetLevel, monthSpend } from '@aio/core/ai';
import { getModuleState } from '@aio/core';
import { HttpError } from './api';
import { db, env } from './server';

export function keyring(): EncryptionKeyring {
  env(); // ensures the repository .env is loaded into process.env
  try {
    return keyringFromEnv(process.env);
  } catch {
    throw new HttpError(503, 'AI_ENCRYPTION_KEY is not configured on the server, so provider keys cannot be stored. See README → "Secure key setup".');
  }
}

/** Public credential view: never includes the encrypted or raw key. */
export function publicCredential(r: {
  id: string;
  provider: string;
  label: string;
  baseUrl: string | null;
  keyLast4: string;
  keyVersion: number;
  priority: number;
  enabled: boolean;
  chatModel: string;
  escalationModel: string | null;
  visionModel: string | null;
  extractionModel: string | null;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { id, provider, label, baseUrl, keyLast4, keyVersion, priority, enabled, chatModel, escalationModel, visionModel, extractionModel, lastTestAt, lastTestOk, lastError, createdAt, updatedAt } = r;
  return { id, provider, label, baseUrl, keyLast4, keyVersion, priority, enabled, chatModel, escalationModel, visionModel, extractionModel, lastTestAt, lastTestOk, lastError, createdAt, updatedAt };
}

export async function budgetState(guildId: string) {
  const { settings } = await getModuleState(db(), guildId, 'ai');
  const spent = await monthSpend(db(), guildId);
  return { spent, level: budgetLevel(spent, settings.budget), budget: settings.budget, pricing: settings.pricing };
}

const model = z.string().min(1).max(100).regex(/^[\w.:/-]+$/, 'Invalid model name');

export const credentialSchema = z.object({
  provider: z.enum(['google', 'openai', 'anthropic', 'openrouter', 'openai_compatible']),
  label: z.string().min(1).max(60),
  baseUrl: z.string().max(300).nullable().optional(),
  apiKey: z.string().min(8).max(400),
  chatModel: model,
  escalationModel: model.nullable().optional(),
  visionModel: model.nullable().optional(),
  extractionModel: model.nullable().optional(),
  enabled: z.boolean().default(true),
});
