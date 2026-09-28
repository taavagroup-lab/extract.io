import { THREAT_CONFIG } from '@extract/game-config';
import { PLAYER_FLAGS, type GameEvent } from '@extract/game-types';
import { computeRunXp, dist2 } from '@extract/shared';
import { describe, expect, it } from 'vitest';
import { FakeChannel, createRoom, map, startedRoomWithTwo, tickFor } from './helpers';

const KINGPIN_MIN = THREAT_CONFIG.tiers.find((t) => t.id === 'KINGPIN')!.minCents;

function events(c: FakeChannel): GameEvent[] {
  return c.messages.flatMap((m) => (m.t === 'snap' && m.ev ? m.ev : []));
}

describe('KINGPIN threat tier', () => {
  it('flags, announces and reveals an approximate position once the bag reaches the tier', async () => {
    const { room, c1, c2, p1 } = await startedRoomWithTwo();
    p1.inventory.addItem('genesis_crown', 1);
    expect(p1.bagValue()).toBeGreaterThanOrEqual(KINGPIN_MIN);
    tickFor(room, 700);

    expect(p1.kingpin).toBe(true);
    expect(p1.computeNet()[9] & PLAYER_FLAGS.KINGPIN).toBeTruthy();
    for (const c of [c1, c2]) {
      const ev = events(c).find((e) => e.e === 'kingpin');
      expect(ev).toMatchObject({ e: 'kingpin', playerId: p1.id, name: 'Alice' });
    }
    const marker = room.globalState().kingpins.find((k) => k.playerId === p1.id);
    expect(marker).toBeDefined();
    expect(dist2(marker!.x, marker!.y, p1.x, p1.y)).toBeLessThanOrEqual(marker!.radius * marker!.radius);
    expect(marker!.bagCents).toBe(p1.bagValue());
  });

  it('clears the state when the bag drops below the tier', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    p1.inventory.addItem('genesis_crown', 1);
    tickFor(room, 700);
    expect(p1.kingpin).toBe(true);
    const slot = p1.inventory.slots.findIndex((s) => s?.itemId === 'genesis_crown');
    room.handleInventory(p1, { op: 'drop', slot });
    tickFor(room, THREAT_CONFIG.kingpinReveal.intervalMs + 600);
    expect(p1.kingpin).toBe(false);
    expect(room.globalState().kingpins).toHaveLength(0);
  });

  it('keeps positions private when the reveal is disabled', async () => {
    const ctx = createRoom({ kingpin: { ...THREAT_CONFIG.kingpinReveal, enabled: false, announce: false } });
    await ctx.room.init();
    const c1 = new FakeChannel();
    const p1 = ctx.room.addHuman('Alice', 'user-alice', c1);
    ctx.room.addHuman('Bob', 'user-bob', new FakeChannel());
    tickFor(ctx.room, 5200);
    p1.inventory.addItem('genesis_crown', 1);
    tickFor(ctx.room, 1000);
    expect(p1.kingpin).toBe(true);
    expect(ctx.room.globalState().kingpins).toHaveLength(0);
    expect(events(c1).some((e) => e.e === 'kingpin')).toBe(false);
  });
});

describe('season XP', () => {
  it('is computed server side and persisted with the extraction', async () => {
    const { room, persistence, c1, p1 } = await startedRoomWithTwo();
    p1.inventory.addItem('gold_bar', 2);
    p1.kills = 2;
    tickFor(room, 3000);
    const value = p1.bagValue();
    const survivedMs = Math.round(room.now - p1.spawnedAt);
    room.extractPlayer(p1, map.extractionPoints[0]!);

    const expected = computeRunXp({ outcome: 'EXTRACTED', kills: 2, bountyKills: 0, survivedMs, extractedValueCents: value }).total;
    expect(expected).toBeGreaterThan(0);
    expect(c1.last('extracted')?.x.xp).toBe(expected);
    await new Promise((r) => setTimeout(r, 10));
    expect(persistence.results.find((r) => r.userId === 'user-alice')?.xp).toBe(expected);
  });
});
