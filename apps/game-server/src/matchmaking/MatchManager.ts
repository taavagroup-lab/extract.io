import { MATCH_CONFIG, NETWORK_CONFIG } from '@extract/game-config';
import type { ClientMessage, MapData } from '@extract/game-types';
import { verifyAccessToken, type AnalyticsBus, type Logger } from '@extract/server-core';
import { isValidUsername } from '@extract/shared';
import type { NavGrid } from '../bots/NavGrid';
import type { ServerPlayer } from '../game/entities/ServerPlayer';
import { MatchRoom } from '../game/match/MatchRoom';
import type { Metrics } from '../metrics/Metrics';
import type { ClientConnection, ConnectionHandler } from '../net/ClientConnection';
import type { GamePersistence } from '../persistence/types';
import type { ServerConfig } from '../serverConfig';

export interface MatchManagerDeps {
  config: ServerConfig;
  map: MapData;
  nav: NavGrid;
  logger: Logger;
  analytics: AnalyticsBus;
  persistence: GamePersistence & { pending?: number };
  metrics: Metrics;
}

interface Registration {
  room: MatchRoom;
  player: ServerPlayer;
}

const MAX_ROOM_ERRORS = 5;

/**
 * Matchmaking, reconnect registry and the global fixed-rate game loop.
 * Architecture note: rooms are independent, so they can later be sharded
 * across processes (Redis for the registry) without touching game logic.
 */
export class MatchManager implements ConnectionHandler {
  readonly rooms = new Map<string, MatchRoom>();
  private readonly byUser = new Map<string, Registration>();
  private readonly byReconnectKey = new Map<string, Registration>();
  private readonly roomErrors = new Map<string, number>();
  private creating: Promise<MatchRoom> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextTickAt = 0;
  private readonly intervalMs = 1000 / NETWORK_CONFIG.tickRate;
  private anonCounter = 1;

  constructor(private readonly deps: MatchManagerDeps) {}

  start(): void {
    this.nextTickAt = performance.now();
    this.loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const room of this.rooms.values()) room.dispose('Server shutting down');
    this.rooms.clear();
  }

  private readonly loop = (): void => {
    const now = performance.now();
    let ticks = 0;
    while (now >= this.nextTickAt && ticks < 4) {
      const t0 = performance.now();
      this.tickAll();
      this.deps.metrics.recordTick(performance.now() - t0);
      this.nextTickAt += this.intervalMs;
      ticks++;
    }
    // Far behind (e.g. debugger pause): resync instead of fast-forwarding.
    if (now - this.nextTickAt > 1000) this.nextTickAt = now + this.intervalMs;
    this.timer = setTimeout(this.loop, Math.max(1, this.nextTickAt - performance.now()));
  };

  private tickAll(): void {
    for (const room of this.rooms.values()) {
      try {
        room.tick();
      } catch (err) {
        const n = (this.roomErrors.get(room.id) ?? 0) + 1;
        this.roomErrors.set(room.id, n);
        this.deps.logger.error({ err, matchId: room.id, n }, 'room tick failed');
        if (n >= MAX_ROOM_ERRORS) this.disposeRoom(room, 'Match crashed');
      }
    }
    this.cleanup();
  }

  private cleanup(): void {
    for (const room of this.rooms.values()) {
      const finishedLong = room.finishedAt !== null && room.now - room.finishedAt > MATCH_CONFIG.finishedLingerMs;
      const abandonedLobby = room.isLobby && room.members.size === 0 && Date.now() - room.createdAt > 30_000;
      if (finishedLong || abandonedLobby) this.disposeRoom(room, 'Match over');
    }
  }

  private disposeRoom(room: MatchRoom, reason: string): void {
    for (const [k, reg] of this.byUser) if (reg.room === room) this.byUser.delete(k);
    for (const [k, reg] of this.byReconnectKey) if (reg.room === room) this.byReconnectKey.delete(k);
    room.dispose(reason);
    this.rooms.delete(room.id);
    this.roomErrors.delete(room.id);
  }

  private async createRoom(): Promise<MatchRoom> {
    const { config, map, nav, logger, analytics, persistence } = this.deps;
    const room = new MatchRoom({
      map,
      nav,
      logger,
      analytics,
      persistence,
      targetPlayers: config.targetPlayers,
      fillWithBots: config.fillWithBots,
      minHumans: config.minHumans,
      lobbyWaitMs: config.lobbyWaitMs,
      devTools: config.devTools,
      seasonId: config.seasonId,
    });
    await room.init();
    this.rooms.set(room.id, room);
    logger.info({ matchId: room.id }, 'room created');
    return room;
  }

  private async findRoom(): Promise<MatchRoom> {
    const rooms = [...this.rooms.values()];
    const lobby = rooms.find((r) => r.isLobby && r.joinable);
    if (lobby) return lobby;
    const running = rooms.find((r) => r.joinable);
    if (running) return running;
    this.creating ??= this.createRoom().finally(() => {
      this.creating = null;
    });
    return this.creating;
  }

  private findActive(reg: Registration | undefined): Registration | null {
    if (!reg) return null;
    if (!this.rooms.has(reg.room.id) || reg.room.isFinished || reg.player.finished) return null;
    return reg;
  }

  async onJoin(conn: ClientConnection, msg: Extract<ClientMessage, { t: 'join' }>): Promise<void> {
    const { config } = this.deps;
    let userId: string | null = null;
    let name: string;
    if (msg.token) {
      const auth = verifyAccessToken(msg.token, config.jwtSecret);
      if (!auth) {
        conn.send({ t: 'err', code: 'auth_failed', msg: 'Session expired. Please log in again.' });
        conn.close('auth_failed');
        return;
      }
      userId = auth.userId;
      name = auth.username;
    } else {
      if (!config.allowAnonymous) {
        conn.send({ t: 'err', code: 'auth_required', msg: 'Login required' });
        conn.close('auth_required');
        return;
      }
      name = isValidUsername(msg.name) ? msg.name : `Guest${this.anonCounter++}`;
    }

    // Reconnect: by user account, or by the per-run reconnect key.
    const existing =
      (userId ? this.findActive(this.byUser.get(userId)) : null) ??
      (msg.reconnectKey ? this.findActive(this.byReconnectKey.get(msg.reconnectKey)) : null);
    if (existing && (existing.player.userId === userId || (!userId && msg.reconnectKey === existing.player.reconnectKey))) {
      conn.bind(existing.room, existing.player);
      existing.room.reattach(existing.player, conn);
      return;
    }

    const room = await this.findRoom();
    const player = room.addHuman(name, userId, conn);
    conn.bind(room, player);
    const reg = { room, player };
    if (userId) this.byUser.set(userId, reg);
    this.byReconnectKey.set(player.reconnectKey, reg);
  }

  onClosed(conn: ClientConnection): void {
    const { room, player } = conn;
    if (!room || !player || player.channel !== conn) return;
    room.handleDisconnect(player);
    if (!room.members.has(player.id)) {
      if (player.userId) this.byUser.delete(player.userId);
      this.byReconnectKey.delete(player.reconnectKey);
    }
  }

  /** Dev: spawn bots into the newest running (or lobby) room, creating one if needed. */
  async spawnBots(count: number): Promise<{ matchId: string; spawned: number }> {
    const rooms = [...this.rooms.values()].filter((r) => !r.isFinished);
    const room = rooms.find((r) => r.isActive) ?? rooms[0] ?? (await this.createRoom());
    return { matchId: room.id, spawned: room.spawnBots(count) };
  }

  stats(): { rooms: number; playersInWorld: number; bots: number; pendingPersistenceJobs: number } {
    let players = 0;
    let bots = 0;
    for (const r of this.rooms.values()) {
      for (const p of r.world.players.values()) {
        players++;
        if (p.isBot) bots++;
      }
    }
    return { rooms: this.rooms.size, playersInWorld: players, bots, pendingPersistenceJobs: this.deps.persistence.pending ?? 0 };
  }

  /** Public population numbers: connected humans (lobby + raid) and running raids. Bots are not players. */
  publicStatus(): { onlinePlayers: number; activeMatches: number } {
    let onlinePlayers = 0;
    let activeMatches = 0;
    for (const r of this.rooms.values()) {
      onlinePlayers += r.connectedHumans;
      if (r.isActive) activeMatches++;
    }
    return { onlinePlayers, activeMatches };
  }

  describeRooms(): unknown[] {
    return [...this.rooms.values()].map((r) => ({
      matchId: r.id,
      phase: r.phase,
      matchTimeMs: Math.round(r.matchTime),
      members: r.members.size,
      inWorld: r.world.players.size,
      humansConnected: r.connectedHumans,
      groundItems: r.world.items.size,
      bullets: r.world.bullets.length,
    }));
  }
}
