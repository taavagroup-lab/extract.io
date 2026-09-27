import { ECONOMY_CONFIG, MATCH_CONFIG } from '@extract/game-config';
import type { BountyMarker } from '@extract/game-types';
import { logEvent } from '@extract/server-core';
import { calculateBounty, formatCents } from '@extract/shared';
import type { ServerPlayer } from '../entities/ServerPlayer';
import type { MatchRoom } from '../match/MatchRoom';

/**
 * HIGH VALUE TARGETS: players with >= 5 kills carry a bounty. Everyone sees
 * an approximate (fuzzed) position that refreshes every few seconds.
 */
export class BountySystem {
  markers: BountyMarker[] = [];
  private nextRevealAt = 0;

  constructor(private readonly room: MatchRoom) {}

  onKill(killer: ServerPlayer): void {
    const bounty = calculateBounty(killer.kills);
    if (bounty <= killer.bountyCents) return;
    const first = killer.bountyCents === 0;
    killer.bountyCents = bounty;
    if (first) {
      this.room.broadcast({
        e: 'announce',
        text: 'HIGH VALUE TARGET',
        sub: `${killer.name} · bounty ${formatCents(bounty)}`,
        kind: 'danger',
      });
    } else {
      this.room.broadcast({ e: 'bounty', name: killer.name, bountyCents: bounty });
    }
    logEvent(this.room.logger, 'bounty_placed', { matchId: this.room.id, player: killer.name, kills: killer.kills, bounty });
    this.nextRevealAt = 0;
  }

  onRemoved(p: ServerPlayer): void {
    if (p.bountyCents > 0) this.nextRevealAt = 0;
  }

  update(): void {
    const now = this.room.now;
    if (now < this.nextRevealAt) return;
    this.nextRevealAt = now + MATCH_CONFIG.bountyRevealIntervalMs;
    const fuzz = ECONOMY_CONFIG.bounty.positionFuzzRadius;
    const rng = this.room.rng;
    const next: BountyMarker[] = [];
    for (const p of this.room.world.players.values()) {
      if (p.bountyCents <= 0 || !p.inWorld) continue;
      const angle = rng.range(0, Math.PI * 2);
      const r = rng.range(0, fuzz * 0.8);
      next.push({
        playerId: p.id,
        name: p.name,
        x: Math.round(p.x + Math.cos(angle) * r),
        y: Math.round(p.y + Math.sin(angle) * r),
        radius: fuzz,
        bountyCents: p.bountyCents,
        kills: p.kills,
      });
    }
    if (next.length > 0 || this.markers.length > 0) {
      this.markers = next;
      this.room.markGlobalDirty();
    }
  }
}
