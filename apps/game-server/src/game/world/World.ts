import { NETWORK_CONFIG, PLAYER_CONFIG } from '@extract/game-config';
import type { ContainerType, ItemId, MapData, Vec2, ZoneType } from '@extract/game-types';
import { CollisionWorld, SpatialHash, dist2, type Rng } from '@extract/shared';
import type { ServerPlayer } from '../entities/ServerPlayer';
import type { Bullet, Crate, GroundItem } from '../entities/types';

const MAX_GROUND_ITEMS = 4000;
const ITEM_RADIUS = 12;

export interface Drop {
  itemId: ItemId;
  qty: number;
  mag?: number;
}

/**
 * Entity storage + spatial indexes for one match. Holds no game rules; the
 * systems mutate it.
 */
export class World {
  readonly collision: CollisionWorld;
  readonly players = new Map<number, ServerPlayer>();
  readonly playerGrid = new SpatialHash<ServerPlayer>(NETWORK_CONFIG.spatialCellSize);
  readonly items = new Map<number, GroundItem>();
  readonly itemGrid = new SpatialHash<GroundItem>(NETWORK_CONFIG.spatialCellSize);
  readonly crates = new Map<number, Crate>();
  readonly crateGrid = new SpatialHash<Crate>(NETWORK_CONFIG.spatialCellSize);
  readonly bullets: Bullet[] = [];
  private nextEntityId = 1;

  constructor(
    readonly map: MapData,
    private readonly rng: Rng,
  ) {
    this.collision = new CollisionWorld(map.obstacles, map.width, map.height);
    for (const c of map.crates) this.addCrate(c.x, c.y, c.type, c.zone, c.locked);
  }

  newId(): number {
    return this.nextEntityId++;
  }

  addCrate(x: number, y: number, type: ContainerType, zone: ZoneType, locked: boolean, supplyDropId?: number): Crate {
    const crate: Crate = { id: this.newId(), x, y, type, zone, opened: false, locked };
    if (supplyDropId !== undefined) crate.supplyDropId = supplyDropId;
    this.crates.set(crate.id, crate);
    this.crateGrid.insert(crate);
    return crate;
  }

  spawnItem(drop: Drop, x: number, y: number, now: number): GroundItem {
    const p = { x, y };
    this.collision.resolveCircle(p, ITEM_RADIUS);
    const item: GroundItem = { id: this.newId(), x: p.x, y: p.y, itemId: drop.itemId, qty: drop.qty, spawnedAt: now };
    if (drop.mag !== undefined) item.mag = drop.mag;
    this.items.set(item.id, item);
    this.itemGrid.insert(item);
    if (this.items.size > MAX_GROUND_ITEMS) {
      const oldest = this.items.values().next().value;
      if (oldest) this.removeItem(oldest);
    }
    return item;
  }

  removeItem(item: GroundItem): boolean {
    if (!this.items.delete(item.id)) return false;
    this.itemGrid.remove(item);
    return true;
  }

  /** Spreads drops on a ring around a point. */
  scatter(drops: Drop[], x: number, y: number, radius: number, now: number): GroundItem[] {
    const out: GroundItem[] = [];
    const n = drops.length;
    const offset = this.rng.range(0, Math.PI * 2);
    drops.forEach((d, i) => {
      const angle = offset + (i / Math.max(1, n)) * Math.PI * 2;
      const r = n === 1 ? radius * 0.4 : radius * this.rng.range(0.55, 1);
      out.push(this.spawnItem(d, x + Math.cos(angle) * r, y + Math.sin(angle) * r, now));
    });
    return out;
  }

  isWalkable(x: number, y: number, r: number = PLAYER_CONFIG.radius): boolean {
    return !this.collision.circleIntersects(x, y, r);
  }

  /** Picks the spawn point farthest from all living players (best of N random candidates). */
  findSpawnPoint(candidates = 12): Vec2 {
    const spawns = this.map.spawnPoints;
    let best: Vec2 = spawns[0] ?? { x: this.map.width / 2, y: this.map.height / 2 };
    let bestScore = -1;
    for (let i = 0; i < candidates; i++) {
      const s = this.rng.pick(spawns);
      let minD = Infinity;
      for (const p of this.players.values()) {
        if (!p.inWorld) continue;
        minD = Math.min(minD, dist2(p.x, p.y, s.x, s.y));
      }
      if (minD > bestScore) {
        bestScore = minD;
        best = s;
      }
    }
    return { x: best.x, y: best.y };
  }

  randomOpenPoint(margin: number, avoid: (x: number, y: number) => boolean): Vec2 | null {
    for (let i = 0; i < 200; i++) {
      const x = this.rng.range(margin, this.map.width - margin);
      const y = this.rng.range(margin, this.map.height - margin);
      if (!this.collision.circleIntersects(x, y, 60) && !avoid(x, y)) return { x, y };
    }
    return null;
  }
}
