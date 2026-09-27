import { BOT_CONFIG, PLAYER_CONFIG, WEAPONS, getItemDef } from '@extract/game-config';
import { INPUT_BUTTONS, type InputCmd, type Vec2 } from '@extract/game-types';
import { dist2, type Rng } from '@extract/shared';
import type { ServerPlayer } from '../game/entities/ServerPlayer';
import type { MatchRoom } from '../game/match/MatchRoom';
import type { NavGrid } from './NavGrid';

type Mode = 'loot' | 'fight' | 'extract' | 'wander' | 'heal';

interface Goal {
  kind: 'crate' | 'item' | 'zone' | 'wander';
  id: number | string;
  x: number;
  y: number;
}

function toAxis(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy);
  if (len < 4) return [0, 0];
  const nx = dx / len;
  const ny = dy / len;
  return [Math.abs(nx) > 0.38 ? Math.sign(nx) : 0, Math.abs(ny) > 0.38 ? Math.sign(ny) : 0];
}

/**
 * Deliberately simple bot: loots, fights what it sees, heals, and heads to
 * extraction. It only produces the same InputCmds / actions a human client
 * could send, so bots exercise the real server code paths.
 */
export class BotBrain {
  mode: Mode = 'loot';
  private goal: Goal | null = null;
  private path: Vec2[] = [];
  private enemyId: number | null = null;
  private reactionReadyAt = 0;
  private aimError = 0;
  private nextThinkAt = 0;
  private nextRepathAt = 0;
  private strafeSign = 1;
  private nextStrafeFlipAt = 0;
  private lastPos: Vec2 = { x: 0, y: 0 };
  private stuckTicks = 0;
  private wantDash = false;
  private readonly ignored = new Set<string>();
  private seq = 0;
  private readonly extractDelayMs: number;

  constructor(
    private readonly rng: Rng,
    private readonly nav: NavGrid,
  ) {
    this.extractDelayMs = rng.range(BOT_CONFIG.extractDelayMs[0], BOT_CONFIG.extractDelayMs[1]);
    this.nextThinkAt = rng.range(0, BOT_CONFIG.thinkIntervalMs);
  }

  /** Produces exactly one input for this tick. */
  update(room: MatchRoom, p: ServerPlayer): InputCmd {
    if (room.now >= this.nextThinkAt) {
      this.nextThinkAt = room.now + BOT_CONFIG.thinkIntervalMs;
      this.think(room, p);
    }
    return this.act(room, p);
  }

  private think(room: MatchRoom, p: ServerPlayer): void {
    // Stuck detection.
    const moved = dist2(p.x, p.y, this.lastPos.x, this.lastPos.y);
    this.lastPos = { x: p.x, y: p.y };
    if (this.goal && moved < 36) this.stuckTicks++;
    else this.stuckTicks = 0;
    if (this.stuckTicks >= 4) {
      if (this.goal) this.ignored.add(`${this.goal.kind}:${this.goal.id}`);
      this.goal = null;
      this.path = [];
      this.stuckTicks = 0;
    }

    const enemy = this.findEnemy(room, p);
    if (enemy) {
      if (this.enemyId !== enemy.id) {
        this.reactionReadyAt = room.now + this.rng.range(BOT_CONFIG.reactionMs[0], BOT_CONFIG.reactionMs[1]);
        this.selectBestWeapon(room, p);
      }
      this.enemyId = enemy.id;
      this.mode = 'fight';
      this.aimError = this.rng.range(-BOT_CONFIG.aimError, BOT_CONFIG.aimError);
      this.wantDash = this.rng.chance(0.06);
      if (room.now >= this.nextStrafeFlipAt) {
        this.strafeSign = this.rng.chance(0.5) ? 1 : -1;
        this.nextStrafeFlipAt = room.now + this.rng.range(700, 1600);
      }
      return;
    }
    this.enemyId = null;

    if (!p.use) {
      if (p.hp < BOT_CONFIG.healBelowHp && p.inventory.countInBag('medkit') > 0) {
        room.loot.startUse(p, 'medkit');
        this.mode = 'heal';
        return;
      }
      if (p.armor < BOT_CONFIG.armorBelow && p.inventory.countInBag('armor_plate') > 0) {
        room.loot.startUse(p, 'armor_plate');
      }
    }

    const extractTime = room.phase === 'EXTRACTION_PHASE' && room.extraction.anyActive;
    if (extractTime && room.matchTime >= room.phaseStartedAt('EXTRACTION_PHASE') + this.extractDelayMs) {
      this.mode = 'extract';
      const zone = room.extraction.zones
        .filter((z) => z.active)
        .sort((a, b) => dist2(p.x, p.y, a.def.x, a.def.y) - dist2(p.x, p.y, b.def.x, b.def.y))[0];
      if (zone && (!this.goal || this.goal.kind !== 'zone' || this.goal.id !== zone.def.id)) {
        this.setGoal({ kind: 'zone', id: zone.def.id, x: zone.def.x, y: zone.def.y }, room);
      }
      return;
    }

    if (!this.goal || this.goal.kind === 'wander' || this.goal.kind === 'zone') {
      const loot = this.rng.chance(BOT_CONFIG.wanderChance) ? null : this.findLoot(room, p);
      if (loot) {
        this.mode = 'loot';
        this.setGoal(loot, room);
      } else if (!this.goal) {
        this.mode = 'wander';
        const w = room.world.randomOpenPoint(200, () => false);
        if (w) this.setGoal({ kind: 'wander', id: `${Math.round(w.x)},${Math.round(w.y)}`, x: w.x, y: w.y }, room);
      }
    }
    // Drop goals that vanished (someone else looted them).
    if (this.goal?.kind === 'item' && !room.world.items.has(this.goal.id as number)) this.goal = null;
    if (this.goal?.kind === 'crate' && room.world.crates.get(this.goal.id as number)?.opened) this.goal = null;
  }

  private setGoal(goal: Goal, room: MatchRoom): void {
    this.goal = goal;
    this.path = [];
    this.nextRepathAt = room.now;
  }

  private findEnemy(room: MatchRoom, p: ServerPlayer): ServerPlayer | null {
    const candidates = room.world.playerGrid.queryRadius(p.x, p.y, BOT_CONFIG.visionRange);
    let best: ServerPlayer | null = null;
    let bestD = Infinity;
    for (const o of candidates) {
      if (o === p || !o.inWorld) continue;
      const d = dist2(p.x, p.y, o.x, o.y);
      if (d < bestD && room.world.collision.lineOfSight(p.x, p.y, o.x, o.y)) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  private findLoot(room: MatchRoom, p: ServerPlayer): Goal | null {
    const r = BOT_CONFIG.lootSearchRange;
    let best: Goal | null = null;
    let bestD = Infinity;
    const bagFull = p.inventory.slots.every((s) => s !== null);
    for (const it of room.world.itemGrid.queryRadius(p.x, p.y, r)) {
      if (this.ignored.has(`item:${it.id}`)) continue;
      const def = getItemDef(it.itemId);
      if (def.type === 'WEAPON' && p.inventory.weapons.some((w) => w?.itemId === it.itemId)) continue;
      if (bagFull && def.type !== 'WEAPON' && def.type !== 'AMMO') continue;
      if (def.type === 'AMMO' && def.metadata.ammoType && p.inventory.ammo[def.metadata.ammoType] >= PLAYER_CONFIG.maxAmmo[def.metadata.ammoType]) continue;
      const d = dist2(p.x, p.y, it.x, it.y) * (def.type === 'WEAPON' ? 0.5 : 1);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'item', id: it.id, x: it.x, y: it.y };
      }
    }
    for (const c of room.world.crateGrid.queryRadius(p.x, p.y, r)) {
      if (c.opened || c.locked || this.ignored.has(`crate:${c.id}`)) continue;
      const d = dist2(p.x, p.y, c.x, c.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'crate', id: c.id, x: c.x, y: c.y };
      }
    }
    return best;
  }

  private selectBestWeapon(room: MatchRoom, p: ServerPlayer): void {
    let bestSlot = p.inventory.activeSlot;
    let bestScore = -1;
    p.inventory.weapons.forEach((w, slot) => {
      if (!w) return;
      const def = WEAPONS[w.weaponId];
      if (w.mag <= 0 && p.inventory.ammo[def.ammoType] <= 0) return;
      const score = (def.damage * def.pellets * 1000) / def.fireIntervalMs;
      if (score > bestScore) {
        bestScore = score;
        bestSlot = slot;
      }
    });
    room.combat.switchWeapon(p, bestSlot);
  }

  private followPath(room: MatchRoom, p: ServerPlayer): [number, number] {
    if (!this.goal) return [0, 0];
    if (room.now >= this.nextRepathAt || this.path.length === 0) {
      this.nextRepathAt = room.now + BOT_CONFIG.repathIntervalMs + this.rng.range(0, 600);
      const path = this.nav.findPath({ x: p.x, y: p.y }, this.goal);
      if (!path) {
        this.ignored.add(`${this.goal.kind}:${this.goal.id}`);
        this.goal = null;
        return [0, 0];
      }
      this.path = path;
    }
    while (this.path.length > 1 && dist2(p.x, p.y, this.path[0]!.x, this.path[0]!.y) < 18 * 18) this.path.shift();
    const wp = this.path[0];
    return wp ? toAxis(wp.x - p.x, wp.y - p.y) : [0, 0];
  }

  private act(room: MatchRoom, p: ServerPlayer): InputCmd {
    let mx = 0;
    let my = 0;
    let buttons = 0;
    let aim = p.rotation;

    const enemy = this.enemyId !== null ? room.world.players.get(this.enemyId) : undefined;
    if (this.mode === 'fight' && enemy && enemy.inWorld) {
      const dx = enemy.x - p.x;
      const dy = enemy.y - p.y;
      const d = Math.hypot(dx, dy);
      aim = Math.atan2(dy, dx) + this.aimError;
      const weapon = p.activeWeaponDef();
      const preferred = weapon?.id === 'shotgun' ? 150 : weapon?.id === 'smg' ? 260 : 360;
      let fx = 0;
      let fy = 0;
      if (d > preferred + 90) {
        fx = dx / d;
        fy = dy / d;
      } else if (d < preferred - 90) {
        fx = -dx / d;
        fy = -dy / d;
      }
      // Strafe perpendicular to the enemy.
      fx += (-dy / d) * 0.8 * this.strafeSign;
      fy += (dx / d) * 0.8 * this.strafeSign;
      [mx, my] = toAxis(fx * 100, fy * 100);
      const canShoot = room.now >= this.reactionReadyAt && d <= BOT_CONFIG.engageRange && !p.use;
      if (canShoot && room.world.collision.lineOfSight(p.x, p.y, enemy.x, enemy.y)) buttons |= INPUT_BUTTONS.FIRE;
      if (this.wantDash) {
        buttons |= INPUT_BUTTONS.DASH;
        this.wantDash = false;
      }
    } else if (this.goal) {
      const reach = this.goal.kind === 'zone' ? 40 : PLAYER_CONFIG.interactRange * 0.6;
      const close = dist2(p.x, p.y, this.goal.x, this.goal.y) < reach * reach;
      if (close) {
        if (this.goal.kind === 'crate' || this.goal.kind === 'item') {
          room.loot.interact(p);
          this.ignored.add(`${this.goal.kind}:${this.goal.id}`);
          this.goal = null;
        } else if (this.goal.kind === 'wander') {
          this.goal = null;
        }
        // In a zone: stand still until extracted.
      } else {
        [mx, my] = this.followPath(room, p);
      }
      if (mx !== 0 || my !== 0) aim = Math.atan2(my, mx);
    }

    return { s: ++this.seq, mx, my, a: aim, b: buttons };
  }
}
