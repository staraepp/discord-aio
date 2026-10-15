import { createServer, type Server } from 'node:http';
import { checkDbHealth } from '@aio/db';
import type { BotContext } from './context.js';

/** Minimal health endpoint for Docker/VPS monitoring. Exposes no secrets. */
export function startHealthServer(ctx: BotContext, port: number): Server {
  const server = createServer(async (req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const db = await checkDbHealth(ctx.db);
    const discord = ctx.client.isReady();
    const body = {
      status: db.ok && discord ? 'ok' : 'degraded',
      discord: discord ? 'connected' : 'disconnected',
      gatewayPingMs: discord ? ctx.client.ws.ping : null,
      database: db.ok ? 'ok' : 'error',
      music: ctx.music ? (ctx.music.configured ? (ctx.music.playback?.isNodeConnected() ? 'connected' : 'backend_unreachable') : 'not_configured') : 'disabled',
      uptimeSec: Math.round((Date.now() - ctx.startedAt.getTime()) / 1000),
    };
    res.writeHead(body.status === 'ok' ? 200 : 503, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  server.listen(port);
  return server;
}
