import { MAP_CONFIG, PLAYER_CONFIG } from '@extract/game-config';
import { INPUT_BUTTONS } from '@extract/game-types';
import { describe, expect, it } from 'vitest';
import {
  CollisionWorld,
  Rng,
  SpatialHash,
  calculateBounty,
  calculateMarketplaceFee,
  decodeMessage,
  encodeMessage,
  generateMap,
  stepMovement,
  validateClientMessage,
  type MoveState,
} from '../src';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('generateMap', () => {
  const map = generateMap();

  it('is deterministic', () => {
    const again = generateMap();
    expect(again.obstacles.length).toBe(map.obstacles.length);
    expect(again.crates).toEqual(map.crates);
  });

  it('contains all zones, crates, extraction points and enough spawns', () => {
    const zoneTypes = new Set(map.zones.map((z) => z.type));
    for (const t of ['CITY', 'FACTORY', 'FOREST', 'PORT', 'GAS_STATION', 'HIGH_VALUE']) expect(zoneTypes.has(t as never)).toBe(true);
    expect(map.crates.length).toBeGreaterThan(150);
    expect(map.crates.filter((c) => c.type === 'LEGENDARY').length).toBe(5);
    expect(map.extractionPoints.length).toBe(MAP_CONFIG.extractionPoints.length);
    expect(map.spawnPoints.length).toBeGreaterThanOrEqual(100);
  });

  it('keeps spawn points and extraction centers free of obstacles', () => {
    const world = new CollisionWorld(map.obstacles, map.width, map.height);
    for (const s of map.spawnPoints) expect(world.circleIntersects(s.x, s.y, PLAYER_CONFIG.radius)).toBe(false);
    for (const e of map.extractionPoints) expect(world.circleIntersects(e.x, e.y, PLAYER_CONFIG.radius)).toBe(false);
  });
});

describe('movement & collision', () => {
  const wall = { kind: 'rect' as const, id: 1, x: 200, y: 0, w: 20, h: 400, style: 'wall' as const };
  const world = new CollisionWorld([wall], 1000, 1000);
  const fresh = (): MoveState => ({ x: 100, y: 200, dashTime: 0, dashCooldown: 0, dashDirX: 0, dashDirY: 0 });

  it('moves at the configured speed', () => {
    const s = fresh();
    stepMovement(s, { mx: 0, my: 1, b: 0 }, 1 / 30, world);
    expect(s.y - 200).toBeCloseTo(PLAYER_CONFIG.movementSpeed / 30, 5);
  });

  it('never passes through walls, even while dashing', () => {
    const s = fresh();
    for (let i = 0; i < 90; i++) stepMovement(s, { mx: 1, my: 0, b: INPUT_BUTTONS.DASH }, 1 / 30, world);
    expect(s.x).toBeLessThanOrEqual(200 - PLAYER_CONFIG.radius + 0.001);
  });

  it('diagonal movement is normalized', () => {
    const s = fresh();
    stepMovement(s, { mx: -1, my: 1, b: 0 }, 1 / 30, world);
    const moved = Math.hypot(s.x - 100, s.y - 200);
    expect(moved).toBeCloseTo(PLAYER_CONFIG.movementSpeed / 30, 5);
  });

  it('raycast hits the wall', () => {
    const hit = world.raycast(100, 200, 400, 200);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(1 / 3, 5);
  });
});

describe('SpatialHash', () => {
  it('queries by rect and radius and tracks moves', () => {
    const h = new SpatialHash<{ id: number; x: number; y: number }>(100);
    const a = { id: 1, x: 50, y: 50 };
    const b = { id: 2, x: 950, y: 950 };
    h.insert(a);
    h.insert(b);
    expect(h.queryRect(0, 0, 200, 200).map((e) => e.id)).toEqual([1]);
    a.x = 900;
    a.y = 900;
    h.update(a);
    expect(h.queryRadius(925, 925, 60).map((e) => e.id).sort()).toEqual([1, 2]);
    h.remove(b);
    expect(h.size).toBe(1);
  });
});

describe('protocol', () => {
  it('round-trips messages through msgpack', () => {
    const msg = { t: 'input' as const, i: [{ s: 1, mx: 1, my: 0, a: 1.5, b: 1 }] };
    const decoded = validateClientMessage(decodeMessage(encodeMessage(msg)));
    expect(decoded?.t).toBe('input');
  });

  it('rejects malformed or out-of-range input', () => {
    expect(validateClientMessage({ t: 'input', i: [{ s: 1, mx: 5, my: 0, a: 0, b: 0 }] })).toBeNull();
    expect(validateClientMessage({ t: 'input', i: [{ s: 1, mx: 0.5, my: 0, a: 0, b: 0 }] })).toBeNull();
    expect(validateClientMessage({ t: 'act', a: { k: 'switch', slot: 7 } })).toBeNull();
    expect(validateClientMessage({ t: 'dev', d: { cmd: 'spawnItem', itemId: 'not_real', qty: 1 } })).toBeNull();
    expect(validateClientMessage({ t: 'hack' })).toBeNull();
  });
});

describe('economy', () => {
  it('marketplace fee: $100 -> $5 fee, $95 seller', () => {
    expect(calculateMarketplaceFee(10_000, 500)).toEqual({ priceCents: 10_000, feeCents: 500, sellerProceedsCents: 9_500 });
  });

  it('bounty table and growth', () => {
    expect(calculateBounty(4)).toBe(0);
    expect(calculateBounty(5)).toBe(500);
    expect(calculateBounty(6)).toBe(800);
    expect(calculateBounty(7)).toBe(1200);
    expect(calculateBounty(8)).toBe(1800);
    expect(calculateBounty(9)).toBe(2700);
  });
});
