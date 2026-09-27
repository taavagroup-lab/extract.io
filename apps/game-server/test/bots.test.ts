import { MATCH_CONFIG } from '@extract/game-config';
import { describe, expect, it } from 'vitest';
import { FakeChannel, createRoom, tickFor } from './helpers';

describe('bots', () => {
  it('a 20-player bot match runs, loots, fights and extracts without errors', async () => {
    const { room } = createRoom({ targetPlayers: 20, fillWithBots: true, lobbyWaitMs: 500, seed: 42 });
    await room.init();
    const human = room.addHuman('Watcher', null, new FakeChannel());
    tickFor(room, 6000);
    expect(room.phase).toBe('LOOT_PHASE');
    expect(room.world.players.size).toBe(20);
    // Keep the human out of the fight so the match keeps running.
    human.hp = 1e9;

    const start = new Map([...room.world.players.values()].map((p) => [p.id, { x: p.x, y: p.y }]));
    const t0 = performance.now();
    tickFor(room, 120_000);
    const msPerTick = (performance.now() - t0) / 3600;

    const bots = [...room.members.values()].filter((p) => p.isBot);
    const moved = bots.filter((b) => {
      const s = start.get(b.id)!;
      return Math.hypot(b.x - s.x, b.y - s.y) > 100 || !b.inWorld;
    });
    expect(moved.length).toBeGreaterThan(15);
    const opened = [...room.world.crates.values()].filter((c) => c.opened).length;
    expect(opened).toBeGreaterThan(10);
    expect(bots.some((b) => b.inventory.value() > 0 || !b.inWorld)).toBe(true);
    expect(msPerTick).toBeLessThan(10);

    // Jump to the extraction phase: bots walk to the zones.
    room.handleDev(human, { cmd: 'setMatchTime', ms: MATCH_CONFIG.phases[2].startMs });
    tickFor(room, 150_000);
    const extracted = bots.filter((b) => b.status === 'EXTRACTED').length;
    const dead = bots.filter((b) => b.status === 'DEAD').length;
    expect(extracted + dead).toBeGreaterThan(0);
  }, 60_000);
});
