import { NETWORK_CONFIG } from '@extract/game-config';
import type { Logger } from '@extract/server-core';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { Metrics } from '../metrics/Metrics';
import { ClientConnection, type ConnectionHandler } from './ClientConnection';

const HEARTBEAT_MS = 10_000;

/** Accepts WebSocket connections on /ws and detects dead sockets via ping/pong. */
export class GameSocketServer {
  private readonly wss: WebSocketServer;
  private readonly connections = new Set<ClientConnection>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(server: Server, handler: ConnectionHandler, metrics: Metrics, logger: Logger) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      maxPayload: NETWORK_CONFIG.maxMessageBytes,
      perMessageDeflate: false,
    });
    this.wss.on('connection', (ws, req) => {
      const addr = req.socket.remoteAddress ?? 'unknown';
      const conn = new ClientConnection(
        ws,
        {
          onJoin: (c, msg) => handler.onJoin(c, msg),
          onClosed: (c) => {
            this.connections.delete(c);
            metrics.connectedClients = this.connections.size;
            handler.onClosed(c);
          },
        },
        metrics,
        logger,
        addr,
      );
      this.connections.add(conn);
      metrics.connectedClients = this.connections.size;
    });
    this.wss.on('error', (err) => logger.error({ err }, 'websocket server error'));

    this.heartbeat = setInterval(() => {
      for (const c of this.connections) {
        if (!c.alive) {
          c.terminate();
          continue;
        }
        c.alive = false;
        c.ping();
      }
    }, HEARTBEAT_MS);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.connections) c.close('Server shutting down');
    this.wss.close();
  }
}
