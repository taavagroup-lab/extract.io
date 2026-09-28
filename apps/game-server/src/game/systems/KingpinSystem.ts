import { THREAT_CONFIG, type KingpinRevealConfig } from '@extract/game-config';
import type { KingpinMarker } from '@extract/game-types';
import { logEvent } from '@extract/server-core';
import { isTierAtLeast } from '@extract/shared';
import type { ServerPlayer } from '../entities/ServerPlayer';
import type { MatchRoom } from '../match/MatchRoom';

/** Bag values are re-evaluated at this cadence (not every tick). */
const SCAN_INTERVAL_MS = 500;

/**
 * KINGPIN: a player whose (server-side) bag value reaches the configured
 * threat tier. They are flagged for nearby players and, when enabled, their
 * approximate (fuzzed) position is broadcast periodically to everyone.
 */
export class KingpinSystem {
  markers: KingpinMarker[] = [];
  private nextScanAt = 0;
  private nextRevealAt = 0;
  private readonly lastAnnouncedAt = new Map<number, number>();

  constructor(
    private readonly room: MatchRoom,
    private readonly cfg: KingpinRevealConfig = THREAT_CONFIG.kingpinReveal,
  ) {}

  update(): void {
    const now = this.room.now;
    if (now >= this.nextScanAt) {
      this.nextScanAt = now + SCAN_INTERVAL_MS;
      this.scan();
    }
    if (now >= this.nextRevealAt) {
      this.nextRevealAt = now + this.cfg.intervalMs;
      this.reveal();
    }
  }

  onRemoved(p: ServerPlayer): void {
    if (!p.kingpin) return;
    p.kingpin = false;
    this.nextRevealAt = 0;
  }

  private scan(): void {
    for (const p of this.room.world.players.values()) {
      if (!p.inWorld) continue;
      const value = p.bagValue();
      const isKingpin = isTierAtLeast(value, this.cfg.minTier);
      if (isKingpin === p.kingpin) continue;
      p.kingpin = isKingpin;
      if (isKingpin) this.onBecameKingpin(p, value);
      this.nextRevealAt = 0;
    }
  }

  private onBecameKingpin(p: ServerPlayer, value: number): void {
    const now = this.room.now;
    const last = this.lastAnnouncedAt.get(p.id);
    if (this.cfg.announce && (last === undefined || now - last >= this.cfg.reannounceCooldownMs)) {
      this.lastAnnouncedAt.set(p.id, now);
      this.room.broadcast({ e: 'kingpin', playerId: p.id, name: p.name, bagCents: value });
    }
    if (p.isHuman) logEvent(this.room.logger, 'kingpin_detected', { matchId: this.room.id, player: p.name, bagCents: value });
  }

  private reveal(): void {
    const next: KingpinMarker[] = [];
    if (this.cfg.enabled) {
      const rng = this.room.rng;
      const fuzz = this.cfg.fuzzRadius;
      for (const p of this.room.world.players.values()) {
        if (!p.kingpin || !p.inWorld) continue;
        const angle = rng.range(0, Math.PI * 2);
        const r = rng.range(0, fuzz * 0.8);
        next.push({
          playerId: p.id,
          name: p.name,
          x: Math.round(p.x + Math.cos(angle) * r),
          y: Math.round(p.y + Math.sin(angle) * r),
          radius: fuzz,
          bagCents: p.bagValue(),
        });
      }
    }
    if (next.length > 0 || this.markers.length > 0) {
      this.markers = next;
      this.room.markGlobalDirty();
    }
  }
}
