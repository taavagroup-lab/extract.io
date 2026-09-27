import { EXTRACTION_CONFIG } from '@extract/game-config';
import type { ExtractionPointDef, ExtractionProgress, ExtractionState } from '@extract/game-types';
import { logEvent } from '@extract/server-core';
import { dist2 } from '@extract/shared';
import type { ServerPlayer } from '../entities/ServerPlayer';
import type { MatchRoom } from '../match/MatchRoom';

interface ZoneRuntime {
  def: ExtractionPointDef;
  active: boolean;
  activationTime: number | null;
  extracting: Set<number>;
}

/** Grace period after taking damage before a new extraction can start. */
const RESTART_DELAY_MS = 1000;

/**
 * Extraction zones. The server continuously validates that the player is
 * alive, inside the radius and not interrupted; only then does the 10 s
 * countdown complete.
 */
export class ExtractionSystem {
  readonly zones: ZoneRuntime[];

  constructor(private readonly room: MatchRoom) {
    this.zones = room.world.map.extractionPoints.map((def) => ({
      def,
      active: false,
      activationTime: null,
      extracting: new Set<number>(),
    }));
  }

  get anyActive(): boolean {
    return this.zones.some((z) => z.active);
  }

  /** Activates `count` random inactive zones. */
  activate(count: number = EXTRACTION_CONFIG.activeCount): void {
    const inactive = this.room.rng.shuffle(this.zones.filter((z) => !z.active));
    const chosen = inactive.slice(0, count);
    if (chosen.length === 0) return;
    for (const z of chosen) {
      z.active = true;
      z.activationTime = this.room.matchTime;
    }
    this.room.broadcast({
      e: 'announce',
      text: 'EXTRACTION AVAILABLE',
      sub: chosen.map((z) => z.def.name).join(' · '),
      kind: 'success',
    });
    this.room.markGlobalDirty();
  }

  private zoneOf(p: ServerPlayer): ZoneRuntime | null {
    if (!p.extraction) return null;
    const id = p.extraction.zoneId;
    return this.zones.find((z) => z.def.id === id) ?? null;
  }

  private inside(p: ServerPlayer, z: ZoneRuntime): boolean {
    return dist2(p.x, p.y, z.def.x, z.def.y) <= z.def.radius * z.def.radius;
  }

  update(): void {
    const now = this.room.now;
    for (const p of this.room.world.players.values()) {
      const zone = this.zoneOf(p);
      if (zone) {
        if (p.status !== 'EXTRACTING') this.cancel(p, 'Interrupted');
        else if (!this.inside(p, zone)) this.cancel(p, 'Left the extraction zone');
        else if (now - p.extraction!.startedAt >= EXTRACTION_CONFIG.durationMs) this.complete(p, zone);
        continue;
      }
      if (p.status !== 'ALIVE' || now < p.lastDamagedAt + RESTART_DELAY_MS) continue;
      for (const z of this.zones) {
        if (!z.active || !this.inside(p, z)) continue;
        const max = EXTRACTION_CONFIG.maxSimultaneousPerZone;
        if (max > 0 && z.extracting.size >= max) continue;
        this.start(p, z);
        break;
      }
    }
  }

  private start(p: ServerPlayer, z: ZoneRuntime): void {
    p.status = 'EXTRACTING';
    p.extraction = { zoneId: z.def.id, startedAt: this.room.now };
    z.extracting.add(p.id);
    this.room.emitTo(p, { e: 'extract', state: 'started', zoneId: z.def.id });
    this.room.emitNear(z.def.x, z.def.y, EXTRACTION_CONFIG.alertRadius, { e: 'extractAlert', zoneId: z.def.id, x: z.def.x, y: z.def.y }, p);
    this.room.markGlobalDirty();
    if (p.isHuman) logEvent(this.room.logger, 'extraction_started', { matchId: this.room.id, player: p.name, zone: z.def.id });
  }

  cancel(p: ServerPlayer, reason: string): void {
    const z = this.zoneOf(p);
    p.extraction = null;
    if (p.status === 'EXTRACTING') p.status = 'ALIVE';
    if (!z) return;
    z.extracting.delete(p.id);
    this.room.emitTo(p, { e: 'extract', state: 'cancelled', zoneId: z.def.id, reason });
    this.room.markGlobalDirty();
    if (p.isHuman) logEvent(this.room.logger, 'extraction_cancelled', { matchId: this.room.id, player: p.name, zone: z.def.id, reason });
  }

  private complete(p: ServerPlayer, z: ZoneRuntime): void {
    z.extracting.delete(p.id);
    p.extraction = null;
    this.room.markGlobalDirty();
    this.room.extractPlayer(p, z.def);
  }

  /** Drops any bookkeeping for a player that left the world. */
  forget(p: ServerPlayer): void {
    for (const z of this.zones) z.extracting.delete(p.id);
    p.extraction = null;
  }

  progressFor(p: ServerPlayer): ExtractionProgress | null {
    if (!p.extraction) return null;
    const elapsed = this.room.now - p.extraction.startedAt;
    const d = EXTRACTION_CONFIG.durationMs;
    return {
      zoneId: p.extraction.zoneId,
      progress: Math.min(1, elapsed / d),
      remainingMs: Math.max(0, d - elapsed),
    };
  }

  toState(): ExtractionState[] {
    return this.zones.map((z) => ({
      id: z.def.id,
      name: z.def.name,
      position: { x: z.def.x, y: z.def.y },
      radius: z.def.radius,
      active: z.active,
      activationTime: z.activationTime,
      playersCurrentlyExtracting: [...z.extracting],
    }));
  }
}
