import { EXTRACTION_CONFIG, MATCH_CONFIG, PLAYER_CONFIG, WEAPONS } from '@extract/game-config';
import { INPUT_BUTTONS, type InputCmd } from '@extract/game-types';
import { calculateBounty } from '@extract/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { MatchStateMachine } from '../src/game/match/MatchStateMachine';
import { ResilientPersistence } from '../src/persistence/ResilientPersistence';
import { MemoryPersistence } from '../src/persistence/MemoryPersistence';
import { FakeChannel, createRoom, openLane, place, startedRoomWithTwo, tickFor } from './helpers';

const FIRE = INPUT_BUTTONS.FIRE;

describe('match state machine', () => {
  it('runs WAITING -> STARTING -> LOOT -> COMBAT -> EXTRACTION -> FINISHED in order', () => {
    const seen: string[] = [];
    const sm = new MatchStateMachine((p) => seen.push(p));
    sm.beginCountdown(0, 5000);
    sm.update(5000);
    expect(sm.phase).toBe('LOOT_PHASE');
    sm.update(5000 + 2 * 60_000);
    expect(sm.phase).toBe('COMBAT_PHASE');
    sm.setMatchTime(5000 + 2 * 60_000, 10 * 60_000); // skip ahead: every hook still fires
    sm.update(5000 + 2 * 60_000);
    expect(seen).toEqual(['STARTING', 'LOOT_PHASE', 'COMBAT_PHASE', 'EXTRACTION_PHASE', 'FINISHED']);
  });
});

describe('milestone: two players, loot, kill, extraction, persistence', () => {
  it('plays the full scenario end to end', async () => {
    const { room, persistence, c1, c2, p1, p2 } = await startedRoomWithTwo();
    expect(room.phase).toBe('LOOT_PHASE');
    expect(c1.last('start')).toBeDefined();
    expect(c2.last('start')).toBeDefined();

    // Both see each other.
    const lane = openLane(room);
    place(room, p1, lane.ax, lane.ay);
    place(room, p2, lane.bx, lane.by);
    tickFor(room, 200);
    const snap = c1.last('snap')!;
    const sawBob = c1.messages.some((m) => m.t === 'snap' && m.pe?.some((e) => e.d[0] === p2.id));
    expect(sawBob || snap.pu?.some((u) => u[0] === p2.id)).toBe(true);

    // Player 1 finds an assault rifle.
    room.world.spawnItem({ itemId: 'assault_rifle', qty: 1 }, p1.x - 30, p1.y, room.now);
    room.handleAction(p1, { k: 'interact' });
    expect(p1.inventory.activeWeapon()?.weaponId).toBe('assault_rifle');
    p1.inventory.addItem('ammo_rifle', 100);

    // Player 2 carries loot worth taking.
    p2.inventory.addItem('gold_bar', 3);
    p2.inventory.addItem('circuit_board', 10);

    // Player 1 shoots player 2 until he dies.
    let seq = 0;
    const hpBefore = p2.hp;
    for (let i = 0; i < 120 && p2.status !== 'DEAD'; i++) {
      room.handleInputs(p1, [{ s: ++seq, mx: 0, my: 0, a: 0, b: FIRE }]);
      room.tick();
      // The rifle needs its raise time (equipMs) before the first round.
      if (i === 25) expect(p2.hp).toBeLessThan(hpBefore);
    }
    expect(p2.status).toBe('DEAD');
    expect(p1.kills).toBe(1);
    const death = c2.last('death')!;
    expect(death.d.killerName).toBe('Alice');
    expect(death.d.lootLostCents).toBeGreaterThan(0);

    // Loot was dropped: pick it all up.
    const deathX = lane.bx;
    const deathY = lane.by;
    place(room, p1, deathX, deathY);
    for (let i = 0; i < 40; i++) {
      room.handleAction(p1, { k: 'interact' });
      room.tick();
    }
    expect(p1.inventory.countInBag('gold_bar') + p1.inventory.countInBag('circuit_board')).toBeGreaterThan(0);

    // Extraction becomes active; walk in and stay 10 s.
    room.handleDev(p1, { cmd: 'setMatchTime', ms: MATCH_CONFIG.phases[2].startMs });
    room.tick();
    expect(room.phase).toBe('EXTRACTION_PHASE');
    const zone = room.extraction.zones.find((z) => z.active)!;
    place(room, p1, zone.def.x, zone.def.y);
    tickFor(room, 100);
    expect(p1.status).toBe('EXTRACTING');
    expect(c1.last('snap')?.self?.extraction?.progress).toBeGreaterThan(0);
    const carried = p1.bagValue();
    tickFor(room, EXTRACTION_CONFIG.durationMs + 200);

    expect(p1.status).toBe('EXTRACTED');
    const extracted = c1.last('extracted')!;
    expect(extracted.x.valueCents).toBe(carried);

    // Loot lands in the persistent inventory (via the persistence port).
    const result = persistence.results.find((r) => r.userId === 'user-alice')!;
    expect(result.outcome).toBe('EXTRACTED');
    expect(result.items.some((i) => i.itemId === 'assault_rifle')).toBe(true);
    expect(result.items.some((i) => i.itemId === 'gold_bar' || i.itemId === 'circuit_board')).toBe(true);
    const bobResult = persistence.results.find((r) => r.userId === 'user-bob')!;
    expect(bobResult.outcome).toBe('DIED');
    expect(persistence.kills).toHaveLength(1);

    // Nobody human left -> match finishes and everyone gets the summary.
    room.tick();
    expect(room.phase).toBe('FINISHED');
    expect(c1.last('end')).toBeDefined();
  });
});

describe('extraction rules', () => {
  it('cancels on damage and on leaving the zone', async () => {
    const { room, c1, p1 } = await startedRoomWithTwo();
    room.handleDev(p1, { cmd: 'activateExtraction' });
    const zone = room.extraction.zones.find((z) => z.active)!;
    place(room, p1, zone.def.x, zone.def.y);
    tickFor(room, 3000);
    expect(p1.status).toBe('EXTRACTING');

    room.combat.applyDamage(p1, 5, null, null, p1.x + 50, p1.y);
    expect(p1.status).toBe('ALIVE');
    expect(c1.messages.some((m) => m.t === 'snap' && m.ev?.some((e) => e.e === 'extract' && e.state === 'cancelled'))).toBe(false);
    room.tick();
    room.tick();
    expect(c1.messages.some((m) => m.t === 'snap' && m.ev?.some((e) => e.e === 'extract' && e.state === 'cancelled'))).toBe(true);

    tickFor(room, 1500); // restarts after the grace period
    expect(p1.status).toBe('EXTRACTING');
    place(room, p1, zone.def.x + zone.def.radius + 60, zone.def.y);
    room.tick();
    expect(p1.status).toBe('ALIVE');
    expect(p1.extraction).toBeNull();
  });

  it('a disconnected player cannot extract and is removed after the reconnect window', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    room.handleDisconnect(p1);
    expect(p1.status).toBe('DISCONNECTED');
    expect(room.world.players.has(p1.id)).toBe(true); // still killable in the world
    tickFor(room, 20_500);
    expect(p1.status).toBe('DEAD');
  });

  it('reconnect within the window restores the character', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    const x = p1.x;
    room.handleDisconnect(p1);
    tickFor(room, 3000);
    const again = new FakeChannel();
    room.reattach(p1, again);
    expect(p1.status).toBe('ALIVE');
    expect(p1.x).toBe(x);
    expect(again.last('welcome')?.playerId).toBe(p1.id);
    tickFor(room, 100);
    expect(again.last('snap')?.self?.id).toBe(p1.id);
  });
});

describe('anti-cheat', () => {
  it('speed hack: flooding inputs never moves faster than real time', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    const lane = openLane(room, 400);
    place(room, p1, lane.ax, lane.ay);
    const step = PLAYER_CONFIG.movementSpeed / 30;
    let seq = 0;
    const flood = () => {
      const inputs: InputCmd[] = Array.from({ length: 8 }, () => ({ s: ++seq, mx: 1, my: 0, a: 0, b: 0 }));
      room.handleInputs(p1, inputs);
    };
    const startX = p1.x;
    flood();
    room.tick();
    // At most one tick of jitter slack on top of the current tick.
    expect(p1.x - startX).toBeLessThanOrEqual(2 * step + 0.001);
    for (let t = 0; t < 29; t++) {
      flood();
      room.tick();
    }
    // Sustained: 30 ticks of real time -> at most ~31 movement steps.
    expect(p1.x - startX).toBeLessThanOrEqual(31 * step + 0.001);
    expect(p1.droppedInputs).toBeGreaterThan(0);
  });

  it('replayed input sequence numbers are ignored', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    room.handleInputs(p1, [{ s: 5, mx: 1, my: 0, a: 0, b: 0 }]);
    room.handleInputs(p1, [{ s: 5, mx: 1, my: 0, a: 0, b: 0 }, { s: 3, mx: 1, my: 0, a: 0, b: 0 }]);
    expect(p1.inputQueue).toHaveLength(1);
  });

  it('fire rate and magazine are enforced server side', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    const pistol = WEAPONS.basic_pistol;
    p1.inventory.ammo.light = 0;
    let seq = 0;
    for (let i = 0; i < 30; i++) {
      room.handleInputs(p1, [{ s: ++seq, mx: 0, my: 0, a: 0, b: FIRE }]);
      room.tick();
    }
    // Semi-auto: holding the trigger fires exactly one round.
    expect(pistol.magazineSize - p1.inventory.activeWeapon()!.mag).toBe(1);
    // Mashing the trigger every tick is still capped by the fire rate.
    const before = p1.inventory.activeWeapon()!.mag;
    for (let i = 0; i < 30; i++) {
      room.handleInputs(p1, [{ s: ++seq, mx: 0, my: 0, a: 0, b: i % 2 === 0 ? FIRE : 0 }]);
      room.tick();
    }
    expect(before - p1.inventory.activeWeapon()!.mag).toBeLessThanOrEqual(Math.ceil(1000 / pistol.fireIntervalMs) + 1);
    for (let i = 0; i < 300; i++) {
      room.handleInputs(p1, [{ s: ++seq, mx: 0, my: 0, a: 0, b: i % 2 === 0 ? FIRE : 0 }]);
      room.tick();
    }
    expect(p1.inventory.activeWeapon()!.mag).toBe(0); // no reserve -> no infinite ammo
  });

  it('pickups are validated by distance and existence', async () => {
    const { room, p1, p2 } = await startedRoomWithTwo();
    const item = room.world.spawnItem({ itemId: 'gold_bar', qty: 1 }, p1.x + 500, p1.y, room.now);
    room.loot.pickup(p1, item);
    expect(p1.inventory.countInBag('gold_bar')).toBe(0);
    place(room, p2, item.x, item.y);
    room.loot.pickup(p2, item);
    room.loot.pickup(p2, item); // already taken
    expect(p2.inventory.countInBag('gold_bar')).toBe(1);
  });

  it('dev commands are ignored when dev tools are disabled', async () => {
    const { room } = createRoom({ devTools: false });
    await room.init();
    const p = room.addHuman('Eve', null, new FakeChannel());
    room.handleDev(p, { cmd: 'giveLegendary' });
    expect(p.inventory.value()).toBe(0);
  });
});

describe('bounty', () => {
  it('a player with 5 kills becomes a high value target and the killer collects it on extraction', async () => {
    const { room, c1, p1, p2 } = await startedRoomWithTwo();
    p2.kills = 4;
    room.killPlayer(room.spawnBot(), p2, 'smg');
    expect(p2.bountyCents).toBe(calculateBounty(5));
    tickFor(room, 100);
    expect(c1.last('snap')?.g?.bounties.length ?? room.globalState().bounties.length).toBe(1);

    room.killPlayer(p2, p1, 'assault_rifle');
    expect(p1.pendingBountyCents).toBe(calculateBounty(5));
    expect(p1.bountyKills).toBe(1);
  });
});

describe('persistence resilience', () => {
  it('retries transient failures until the write succeeds', async () => {
    const inner = new MemoryPersistence();
    let failures = 2;
    const flaky = Object.create(inner) as MemoryPersistence;
    flaky.savePlayerResult = async (r) => {
      if (failures-- > 0) throw new Error('db down');
      return inner.savePlayerResult(r);
    };
    const resilient = new ResilientPersistence(flaky, pino({ level: 'silent' }), { baseDelayMs: 5, maxDelayMs: 10 });
    await resilient.savePlayerResult({
      matchId: 'm1', userId: 'u1', seasonId: null, outcome: 'EXTRACTED', kills: 0, damageDealt: 0, survivedMs: 1,
      lootValueCents: 1, securedValueCents: 1, lostValueCents: 0, bountyEarnedCents: 0, bountyKills: 0, payoutCents: 0,
      items: [{ itemId: 'scrap', qty: 1 }], extraction: null, xp: 0,
    });
    await new Promise((r) => setTimeout(r, 100));
    await resilient.flush();
    expect(inner.results).toHaveLength(1);
    resilient.dispose();
  });
});
