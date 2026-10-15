import { z } from 'zod';
import { getModule, getModuleState, isModuleId, setModuleEnabled, updateModuleSettings } from '@aio/core';
import { adminRoute, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { assertGuildIds, roleHierarchyProblem } from '@/lib/discord';
import { collectIds } from '@/lib/ids';

const bodySchema = z.object({ enabled: z.boolean().optional(), settings: z.unknown().optional() });

export const GET = adminRoute<{ id: string }>(async ({ params, guildId }) => {
  if (!isModuleId(params.id)) throw new HttpError(404, 'Unknown module');
  const state = await getModuleState(db(), guildId, params.id);
  const def = getModule(params.id)!;
  return { ...state, module: { id: def.id, name: def.name, description: def.description, commands: def.commands, integrations: def.integrations } };
});

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  if (!isModuleId(params.id)) throw new HttpError(404, 'Unknown module');
  const body = await readJson(req, bodySchema);
  if (body.settings !== undefined) {
    const ids = collectIds(body.settings);
    const problem = await assertGuildIds(ids);
    if (problem) throw new HttpError(422, problem);
    if (params.id === 'verification') {
      const v = body.settings as { verifiedRoleId?: string; unverifiedRoleId?: string };
      const roleProblem = await roleHierarchyProblem([v.verifiedRoleId, v.unverifiedRoleId]);
      if (roleProblem) throw new HttpError(422, roleProblem);
    }
    const res = await updateModuleSettings(db(), guildId, params.id, body.settings, session.userId);
    if (!res.ok) throw new HttpError(422, 'Please fix the highlighted fields.', res.issues);
  }
  if (body.enabled !== undefined) {
    await setModuleEnabled(db(), guildId, params.id, body.enabled, session.userId);
    await command(session, 'commands.sync');
  }
  await command(session, 'settings.changed', { module: params.id });
  return getModuleState(db(), guildId, params.id);
});
