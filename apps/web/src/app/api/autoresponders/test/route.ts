import { z } from 'zod';
import { findMatchingRule, pickResponse } from '@aio/core/autoresponder';
import { renderTemplate, sampleContext } from '@aio/variables';
import { adminRoute, readJson, snowflake } from '@/lib/api';
import { db } from '@/lib/server';

/** Tests a sample message against the saved rules (same matcher the bot uses). */
export const POST = adminRoute(async ({ req, guildId }) => {
  const body = await readJson(req, z.object({ content: z.string().min(1).max(2000), channelId: snowflake.optional(), roleIds: z.array(snowflake).max(50).default([]) }));
  const rules = await db().autoresponder.findMany({ where: { guildId } });
  const rule = findMatchingRule(rules, { content: body.content, channelId: body.channelId ?? '0', roleIds: body.roleIds });
  if (!rule) return { matched: false };
  const response = rule.responseType === 'text' || rule.responseType === 'random' ? pickResponse(rule.responses) : undefined;
  return { matched: true, rule: { id: rule.id, name: rule.name, responseType: rule.responseType }, preview: response ? renderTemplate(response, sampleContext(), { preview: true }).text : null };
});
