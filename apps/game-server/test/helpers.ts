import type { ServerMessage } from '@extract/game-types';
import { AnalyticsBus, MemoryAnalyticsSink } from '@extract/server-core';
import { CollisionWorld, generateMap } from '@extract/shared';
import pino from 'pino';
import { NavGrid } from '../src/bots/NavGrid';
import type { PlayerChannel, ServerPlayer } from '../src/game/entities/ServerPlayer';
import { MatchRoom, type MatchRoomOptions } from '../src/game/match/MatchRoom';
import { MemoryPersistence } from '../src/persistence/MemoryPersistence';

export const map = generateMap();
export const nav = new NavGrid(new CollisionWorld(map.obstacles, map.width, map.height));

let nextConn = 1;

export class FakeChannel implements PlayerChannel {
  readonly connectionId = nextConn++;
  readonly messages: ServerMessage[] = [];
  closedReason: string | null = null;

  send(msg: ServerMessage): void {
    this.messages.push(msg);
  }

  close(reason: string): void {
    this.closedReason = reason;
  }

  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.t === t) return m as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
}

export function createRoom(overrides: Partial<MatchRoomOptions> = {}) {
  const persistence = new MemoryPersistence();
  const analyticsSink = new MemoryAnalyticsSink();
  const room = new MatchRoom({
    map,
    nav,
    logger: pino({ level: 'silent' }),
    analytics: new AnalyticsBus().addSink(analyticsSink),
    persistence,
    targetPlayers: 2,
    fillWithBots: false,
    lobbyWaitMs: 1000,
    devTools: true,
    seasonId: 'season-1',
    seed: 1234,
    ...overrides,
  });
  return { room, persistence, analyticsSink };
}

export function tickFor(room: MatchRoom, ms: number): void {
  const ticks = Math.ceil(ms / (1000 / 30));
  for (let i = 0; i < ticks; i++) room.tick();
}

/** Starts a room with two humans and runs the countdown into LOOT_PHASE. */
export async function startedRoomWithTwo() {
  const ctx = createRoom();
  await ctx.room.init();
  const c1 = new FakeChannel();
  const c2 = new FakeChannel();
  const p1 = ctx.room.addHuman('Alice', 'user-alice', c1);
  const p2 = ctx.room.addHuman('Bob', 'user-bob', c2);
  tickFor(ctx.room, 5200);
  return { ...ctx, c1, c2, p1, p2 };
}

/** Finds an open spot where b stands `gap` units right of a with clear line of sight. */
export function openLane(room: MatchRoom, gap = 160): { ax: number; ay: number; bx: number; by: number } {
  for (const s of map.spawnPoints) {
    const bx = s.x + gap;
    if (room.world.isWalkable(s.x, s.y, 30) && room.world.isWalkable(bx, s.y, 30) && room.world.collision.lineOfSight(s.x, s.y, bx, s.y)) {
      return { ax: s.x, ay: s.y, bx, by: s.y };
    }
  }
  throw new Error('no open lane found');
}

export function place(room: MatchRoom, p: ServerPlayer, x: number, y: number): void {
  p.move.x = x;
  p.move.y = y;
  room.world.playerGrid.update(p);
}
