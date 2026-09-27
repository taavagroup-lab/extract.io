import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MatchManager } from '../matchmaking/MatchManager';
import type { Metrics } from '../metrics/Metrics';
import type { ServerConfig } from '../serverConfig';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** Plain HTTP endpoints next to the WebSocket: health, metrics and DEV-only tools. */
export function createHttpHandler(manager: MatchManager, metrics: Metrics, config: ServerConfig) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/metrics') return json(res, 200, metrics.snapshot(manager.stats()));

      if (url.pathname.startsWith('/dev/')) {
        if (!config.devTools) return json(res, 404, { error: 'not_found' });
        if (req.method === 'GET' && url.pathname === '/dev/rooms') return json(res, 200, manager.describeRooms());
        if (req.method === 'POST' && url.pathname === '/dev/spawn-bots') {
          const count = Math.max(1, Math.min(100, Number(url.searchParams.get('count') ?? 20) || 20));
          manager
            .spawnBots(count)
            .then((r) => json(res, 200, r))
            .catch((err: unknown) => json(res, 500, { error: String(err) }));
          return;
        }
      }
      json(res, 404, { error: 'not_found' });
    } catch (err) {
      json(res, 500, { error: 'internal_error', message: String(err) });
    }
  };
}
