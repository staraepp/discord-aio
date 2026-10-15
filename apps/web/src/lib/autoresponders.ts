import 'server-only';
import type { AutoresponderInput } from '@aio/core/autoresponder';
import { HttpError } from './api';
import { db } from './server';
import { validateActionRefs, validateRefs } from './validate';

export async function validateAutoresponder(input: AutoresponderInput, guildId: string): Promise<void> {
  await validateRefs({ channels: [...input.allowedChannelIds, ...input.blockedChannelIds], roles: [...input.allowedRoleIds, ...input.blockedRoleIds] });
  await validateActionRefs(input.actions);
  const embedIds = [input.embedId, ...input.actions.map((a) => (a.type === 'send_embed' ? a.embedId : null))].filter(Boolean) as string[];
  if (embedIds.length) {
    const found = await db().savedEmbed.count({ where: { guildId, id: { in: embedIds } } });
    if (found !== new Set(embedIds).size) throw new HttpError(422, 'A referenced saved embed no longer exists.');
  }
}

export async function saveAutoresponder(guildId: string, input: AutoresponderInput, id?: string) {
  const { actions, ...fields } = input;
  const data = { ...fields, embedId: fields.embedId ?? null, deleteResponseAfterSeconds: fields.deleteResponseAfterSeconds ?? null };
  return db().$transaction(async (tx) => {
    const row = id ? await tx.autoresponder.update({ where: { id }, data }) : await tx.autoresponder.create({ data: { ...data, guildId } });
    await tx.autoresponderAction.deleteMany({ where: { autoresponderId: row.id } });
    if (actions.length) await tx.autoresponderAction.createMany({ data: actions.map(({ type, ...config }, position) => ({ autoresponderId: row.id, position, type, config })) });
    return row;
  });
}
