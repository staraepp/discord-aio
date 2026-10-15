import 'server-only';
import { HttpError } from './api';
import { assertGuildIds, roleHierarchyProblem } from './discord';
import { assignableRoleIdsFromActions, collectIds } from './ids';

/** Server-side validation of every channel/role referenced by action specs. */
export async function validateActionRefs(actions: { type: string; roleId?: string }[]): Promise<void> {
  const problem = (await assertGuildIds(collectIds(actions))) ?? (await roleHierarchyProblem(assignableRoleIdsFromActions(actions)));
  if (problem) throw new HttpError(422, problem);
}

export async function validateRefs(ids: { channels?: (string | null | undefined)[]; roles?: (string | null | undefined)[]; channelTypes?: number[] }, assignableRoles: (string | null | undefined)[] = []): Promise<void> {
  const problem = (await assertGuildIds(ids)) ?? (await roleHierarchyProblem(assignableRoles));
  if (problem) throw new HttpError(422, problem);
}
