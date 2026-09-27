import { NETWORK_CONFIG } from '@extract/game-config';
import type { ClientMessage, ServerMessage } from '@extract/game-types';
import { logEvent, type Logger } from '@extract/server-core';
import { decodeMessage, encodeMessage, validateClientMessage } from '@extract/shared';
import { WebSocket, type RawData } from 'ws';
import type { PlayerChannel, ServerPlayer } from '../game/entities/ServerPlayer';
import type { MatchRoom } from '../game/match/MatchRoom';
import type { Metrics } from '../metrics/Metrics';
import { TokenBucket } from './RateLimiter';

/** If a client cannot drain its socket, drop it instead of buffering forever. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

let nextConnectionId = 1;

export interface ConnectionHandler {
  onJoin(conn: ClientConnection, msg: Extract<ClientMessage, { t: 'join' }>): Promise<void>;
  onClosed(conn: ClientConnection): void;
}

/**
 * One WebSocket client. Enforces size and rate limits, decodes + validates
 * every frame, and routes it to the bound room. Never trusts the payload.
 */
export class ClientConnection implements PlayerChannel {
  readonly connectionId = nextConnectionId++;
  room: MatchRoom | null = null;
  player: ServerPlayer | null = null;
  alive = true;
  private readonly bucket = new TokenBucket(NETWORK_CONFIG.rateLimit.messagesPerSecond, NETWORK_CONFIG.rateLimit.burst);
  private violations = 0;
  private joining = false;
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly handler: ConnectionHandler,
    private readonly metrics: Metrics,
    private readonly logger: Logger,
    readonly remoteAddress: string,
  ) {
    ws.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    ws.on('close', () => this.onClose());
    ws.on('error', (err) => this.logger.debug({ err, conn: this.connectionId }, 'socket error'));
    ws.on('pong', () => {
      this.alive = true;
    });
  }

  bind(room: MatchRoom, player: ServerPlayer): void {
    this.room = room;
    this.player = player;
  }

  send(msg: ServerMessage): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.close('Connection too slow');
      return;
    }
    try {
      const data = encodeMessage(msg);
      this.ws.send(data);
      this.metrics.messagesOut++;
      this.metrics.bytesOut += data.byteLength;
    } catch (err) {
      this.logger.warn({ err, conn: this.connectionId }, 'failed to send');
    }
  }

  close(reason: string): void {
    if (this.closed) return;
    this.send({ t: 'kick', reason });
    this.closed = true;
    try {
      this.ws.close(4000, reason.slice(0, 100));
    } catch {
      this.ws.terminate();
    }
  }

  terminate(): void {
    this.ws.terminate();
  }

  ping(): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.ping();
  }

  private violation(reason: string): void {
    this.violations++;
    if (this.violations === 1 || this.violations % 50 === 0) {
      logEvent(this.logger, 'security_violation', { conn: this.connectionId, player: this.player?.name, reason, count: this.violations });
    }
    if (this.violations >= NETWORK_CONFIG.rateLimit.maxViolations) this.close('Too many invalid messages');
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    this.metrics.messagesIn++;
    if (!isBinary || !(data instanceof Buffer)) return this.violation('non-binary frame');
    this.metrics.bytesIn += data.byteLength;
    if (data.byteLength > NETWORK_CONFIG.maxMessageBytes) return this.violation('oversized frame');
    if (!this.bucket.take()) return this.violation('rate limit');

    let msg: ClientMessage | null;
    try {
      msg = validateClientMessage(decodeMessage(data));
    } catch {
      msg = null;
    }
    if (!msg) return this.violation('malformed message');

    try {
      this.dispatch(msg);
    } catch (err) {
      this.logger.error({ err, conn: this.connectionId, t: msg.t }, 'message handler failed');
    }
  }

  private dispatch(msg: ClientMessage): void {
    if (msg.t === 'ping') {
      this.send({ t: 'pong', c: msg.c, s: Date.now() });
      return;
    }
    if (msg.t === 'join') {
      if (this.joining || (this.player && this.room && !this.room.isFinished && !this.player.finished)) return;
      this.joining = true;
      this.handler
        .onJoin(this, msg)
        .catch((err) => {
          this.logger.error({ err }, 'join failed');
          this.send({ t: 'err', code: 'join_failed', msg: 'Could not join a match' });
        })
        .finally(() => {
          this.joining = false;
        });
      return;
    }
    const room = this.room;
    const player = this.player;
    if (!room || !player || player.channel !== this) return;
    switch (msg.t) {
      case 'input':
        room.handleInputs(player, msg.i);
        break;
      case 'act':
        room.handleAction(player, msg.a);
        break;
      case 'inv':
        room.handleInventory(player, msg.o);
        break;
      case 'dev':
        if (room.devTools) room.handleDev(player, msg.d);
        else this.violation('dev command in production');
        break;
      case 'leave':
        room.leave(player);
        this.room = null;
        this.player = null;
        break;
    }
  }

  private onClose(): void {
    this.closed = true;
    this.handler.onClosed(this);
  }
}
