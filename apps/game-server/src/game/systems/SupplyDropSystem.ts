import { MATCH_CONFIG } from '@extract/game-config';
import type { SupplyDropState, Vec2 } from '@extract/game-types';
import { logEvent } from '@extract/server-core';
import { zoneAt } from '@extract/shared';
import type { MatchRoom } from '../match/MatchRoom';

/** Timed supply drops from minute 4: announced, marked on the map, then land as a crate. */
export class SupplyDropSystem {
  readonly drops: SupplyDropState[] = [];
  private nextAtMs: number = MATCH_CONFIG.supplyDrops.firstAtMs;

  constructor(private readonly room: MatchRoom) {}

  update(): void {
    const t = this.room.matchTime;
    const cfg = MATCH_CONFIG.supplyDrops;
    const phase = this.room.phase;
    if ((phase === 'COMBAT_PHASE' || phase === 'EXTRACTION_PHASE') && t >= this.nextAtMs && this.drops.length < cfg.maxPerMatch) {
      this.spawnIncoming();
      this.nextAtMs = t + this.room.rng.range(cfg.intervalMs[0], cfg.intervalMs[1]);
    }
    for (const d of this.drops) {
      if (d.landed || t < d.landsAtMs) continue;
      d.landed = true;
      const zones = this.room.world.map.zones;
      this.room.world.addCrate(d.x, d.y, 'SUPPLY_DROP', zoneAt(zones, d.x, d.y), false, d.id);
      this.room.markGlobalDirty();
    }
  }

  spawnIncoming(at?: Vec2): SupplyDropState | null {
    const zones = this.room.world.map.zones;
    const pos = at ?? this.room.world.randomOpenPoint(300, (x, y) => zoneAt(zones, x, y) === 'HIGH_VALUE');
    if (!pos) return null;
    const drop: SupplyDropState = {
      id: this.room.world.newId(),
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      landsAtMs: this.room.matchTime + MATCH_CONFIG.supplyDrops.fallMs,
      landed: false,
      opened: false,
    };
    this.drops.push(drop);
    this.room.broadcast({ e: 'announce', text: 'SUPPLY DROP INCOMING', sub: 'Marked on your map', kind: 'warning' });
    this.room.markGlobalDirty();
    logEvent(this.room.logger, 'supply_drop', { matchId: this.room.id, x: drop.x, y: drop.y });
    return drop;
  }

  markOpened(id: number): void {
    const d = this.drops.find((x) => x.id === id);
    if (d && !d.opened) {
      d.opened = true;
      this.room.markGlobalDirty();
    }
  }
}
