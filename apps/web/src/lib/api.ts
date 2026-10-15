import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { newErrorId, serializeError } from '@aio/logging';
import { enqueueDashboardCommand, writeAudit, type DashboardCommandType } from '@aio/core';
import { db, env, guildId, log } from './server';
import { getSession, type Session } from './session';
import { csrfProblem } from './csrf';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * CSRF defence for state-changing requests: same-origin Origin header, JSON
 * content type, and a custom header that cross-site forms cannot send.
 */
export function assertSameOrigin(req: NextRequest): void {
  const problem = csrfProblem({
    method: req.method,
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
    expectedOrigin: env().PUBLIC_BASE_URL,
    csrfHeader: req.headers.get('x-aio-csrf'),
  });
  if (problem) throw new HttpError(403, problem);
}

export async function readJson<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Expected application/json');
  const text = await req.text();
  if (text.length > 512_000) throw new HttpError(413, 'Request too large');
  let body: unknown;
  try {
    body = JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(422, 'Please fix the highlighted fields.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return parsed.data;
}

type RouteCtx<P> = { params: Promise<P> };
export interface AdminContext<P> {
  req: NextRequest;
  session: Session;
  params: P;
  guildId: string;
}

function handleError(err: unknown): NextResponse {
  if (err instanceof HttpError) return json({ error: err.message, issues: err.issues }, err.status);
  const errorId = newErrorId();
  log.error({ err: serializeError(err), errorId }, 'api error');
  void db()
    .appErrorLog.create({ data: { errorId, source: 'web.api', message: serializeError(err).message.slice(0, 2000) } })
    .catch(() => undefined);
  return json({ error: `Something went wrong (${errorId}).`, errorId }, 500);
}

/** Wrap an admin-only route: session + server-side guild ADMINISTRATOR check + CSRF for mutations. */
export function adminRoute<P = Record<string, never>>(handler: (c: AdminContext<P>) => Promise<unknown>, opts: { ownerOnly?: boolean } = {}) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<NextResponse> => {
    try {
      assertSameOrigin(req);
      const session = await getSession();
      if (!session) throw new HttpError(401, 'Please sign in.');
      if (opts.ownerOnly ? !session.isOwner : !session.isAdmin) throw new HttpError(403, opts.ownerOnly ? 'Owner only.' : 'You need Administrator permission in the server.');
      const result = await handler({ req, session, params: await ctx.params, guildId: guildId() });
      return result instanceof NextResponse ? result : json(result ?? { ok: true });
    } catch (err) {
      return handleError(err);
    }
  };
}

/** Wrap a public route (forms, verification) with error handling and optional CSRF. */
export function publicRoute<P = Record<string, never>>(handler: (req: NextRequest, params: P) => Promise<unknown>, opts: { csrf?: boolean } = { csrf: true }) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<NextResponse> => {
    try {
      if (opts.csrf) assertSameOrigin(req);
      const result = await handler(req, await ctx.params);
      return result instanceof NextResponse ? result : json(result ?? { ok: true });
    } catch (err) {
      return handleError(err);
    }
  };
}

export async function audit(session: Session, entry: { module: string; action: string; targetId?: string | null; before?: unknown; after?: unknown; meta?: unknown }): Promise<void> {
  await writeAudit(db(), { guildId: guildId(), actorId: session.userId, ...entry });
}

export async function command(session: Session | null, type: DashboardCommandType, payload: Record<string, unknown> = {}): Promise<string> {
  return enqueueDashboardCommand(db(), { guildId: guildId(), type, payload, createdBy: session?.userId ?? null });
}

/** Wait briefly for the bot to finish a dashboard command (returns null if the bot is offline/slow). */
export async function awaitCommand(id: string, timeoutMs = 8000): Promise<{ status: string; result: unknown; error: string | null } | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const row = await db().dashboardCommand.findUnique({ where: { id } });
    if (row && (row.status === 'done' || row.status === 'failed')) return { status: row.status, result: row.result, error: row.error };
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

export const snowflake = z.string().regex(/^\d{17,20}$/);
