import { PLAYER_CONFIG, WEAPONS, weaponIndex } from '@extract/game-config';
import type { WeaponId } from '@extract/game-types';
import { segmentCircle } from '@extract/shared';
import { bulletDamage, computeDamage } from '../combat/damage';
import type { ServerPlayer } from '../entities/ServerPlayer';
import type { Bullet } from '../entities/types';
import type { MatchRoom } from '../match/MatchRoom';

const HIT_QUERY_PAD = PLAYER_CONFIG.radius + 4;

/**
 * Server-authoritative shooting: fire rate, ammo, reload, projectile
 * simulation, hit detection, damage and kill attribution.
 */
export class CombatSystem {
  private readonly hitCandidates: ServerPlayer[] = [];

  constructor(private readonly room: MatchRoom) {}

  canAct(p: ServerPlayer): boolean {
    return p.status === 'ALIVE' || p.status === 'EXTRACTING';
  }

  tryFire(p: ServerPlayer): void {
    const now = this.room.now;
    if (!this.canAct(p) || p.use || p.reload || now < p.nextFireAt) return;
    const weapon = p.inventory.activeWeapon();
    if (!weapon) return;
    const def = WEAPONS[weapon.weaponId];
    if (weapon.mag <= 0) {
      this.startReload(p);
      return;
    }
    weapon.mag -= 1;
    p.nextFireAt = now + def.fireIntervalMs;

    const rng = this.room.rng;
    for (let i = 0; i < def.pellets; i++) {
      const angle = p.rotation + rng.range(-def.spread, def.spread);
      const bullet: Bullet = {
        id: this.room.world.newId(),
        ownerId: p.id,
        weaponId: def.id,
        x: p.x,
        y: p.y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        speed: def.bulletSpeed * (def.pellets > 1 ? rng.range(0.9, 1.05) : 1),
        remaining: def.range,
        traveled: 0,
        damage: def.damage,
      };
      this.room.world.bullets.push(bullet);
      this.room.bulletSpawns.push([
        bullet.id,
        Math.round(p.x),
        Math.round(p.y),
        Math.round(angle * 1000),
        Math.round(bullet.speed),
        def.range,
        weaponIndex(def.id),
        p.id,
      ]);
    }
    if (weapon.mag === 0) this.startReload(p);
  }

  startReload(p: ServerPlayer): void {
    if (!this.canAct(p) || p.reload) return;
    const weapon = p.inventory.activeWeapon();
    if (!weapon) return;
    const def = WEAPONS[weapon.weaponId];
    if (weapon.mag >= def.magazineSize || p.inventory.ammo[def.ammoType] <= 0) return;
    p.use = null;
    p.reload = { slot: p.inventory.activeSlot, endsAt: this.room.now + def.reloadMs, totalMs: def.reloadMs };
  }

  cancelReload(p: ServerPlayer): void {
    p.reload = null;
  }

  /** Completes reloads whose timer elapsed. */
  updateReload(p: ServerPlayer): void {
    const r = p.reload;
    if (!r || this.room.now < r.endsAt) return;
    p.reload = null;
    const weapon = p.inventory.weapons[r.slot];
    if (!weapon || r.slot !== p.inventory.activeSlot) return;
    const def = WEAPONS[weapon.weaponId];
    const take = Math.min(def.magazineSize - weapon.mag, p.inventory.ammo[def.ammoType]);
    weapon.mag += take;
    p.inventory.ammo[def.ammoType] -= take;
  }

  switchWeapon(p: ServerPlayer, slot: number): void {
    if (!this.canAct(p) || slot === p.inventory.activeSlot || !p.inventory.weapons[slot]) return;
    p.inventory.activeSlot = slot;
    p.reload = null;
    p.use = null;
    // Small swap delay prevents swap-canceling fire cooldowns.
    p.nextFireAt = Math.max(p.nextFireAt, this.room.now + 250);
  }

  updateBullets(dt: number): void {
    const world = this.room.world;
    const bullets = world.bullets;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i] as Bullet;
      const step = Math.min(b.speed * dt, b.remaining);
      const ex = b.x + b.dirX * step;
      const ey = b.y + b.dirY * step;
      const dx = ex - b.x;
      const dy = ey - b.y;

      const wall = world.collision.raycast(b.x, b.y, ex, ey);
      let hitT = wall ? wall.t : Infinity;
      let hitPlayer: ServerPlayer | null = null;

      this.hitCandidates.length = 0;
      world.playerGrid.queryRect(
        Math.min(b.x, ex) - HIT_QUERY_PAD,
        Math.min(b.y, ey) - HIT_QUERY_PAD,
        Math.max(b.x, ex) + HIT_QUERY_PAD,
        Math.max(b.y, ey) + HIT_QUERY_PAD,
        this.hitCandidates,
      );
      for (const target of this.hitCandidates) {
        if (target.id === b.ownerId || !target.inWorld) continue;
        const t = segmentCircle(b.x, b.y, dx, dy, target.x, target.y, PLAYER_CONFIG.radius);
        if (t !== null && t < hitT) {
          hitT = t;
          hitPlayer = target;
        }
      }

      if (hitPlayer || wall) {
        const t = Math.min(hitT, 1);
        const hx = b.x + dx * t;
        const hy = b.y + dy * t;
        if (hitPlayer) {
          const owner = world.players.get(b.ownerId) ?? null;
          const dmg = bulletDamage(b.damage, b.traveled + step * t, WEAPONS[b.weaponId].falloff);
          this.applyDamage(hitPlayer, dmg, owner, b.weaponId, b.x, b.y);
        }
        this.room.bulletEnds.push([b.id, Math.round(hx), Math.round(hy), hitPlayer ? 1 : 0]);
        bullets[i] = bullets[bullets.length - 1] as Bullet;
        bullets.pop();
        continue;
      }

      b.x = ex;
      b.y = ey;
      b.remaining -= step;
      b.traveled += step;
      if (b.remaining <= 0.001) {
        bullets[i] = bullets[bullets.length - 1] as Bullet;
        bullets.pop();
      }
    }
  }

  /**
   * The only way health changes downward. Cancels extraction, attributes
   * damage and kills.
   */
  applyDamage(
    target: ServerPlayer,
    amount: number,
    attacker: ServerPlayer | null,
    weaponId: WeaponId | null,
    fromX: number,
    fromY: number,
  ): void {
    if (!target.inWorld || amount <= 0) return;
    const { healthDamage, armorDamage } = computeDamage(amount, target.armor);
    target.armor = Math.max(0, target.armor - armorDamage);
    target.hp -= healthDamage;
    target.lastDamagedAt = this.room.now;
    if (attacker && attacker !== target) {
      target.lastAttackerId = attacker.id;
      attacker.damageDealt += amount;
      this.room.emitTo(attacker, {
        e: 'dmg',
        targetId: target.id,
        amount: Math.round(amount),
        x: Math.round(target.x),
        y: Math.round(target.y),
        armor: armorDamage > 0,
      });
    }
    this.room.emitTo(target, { e: 'hurt', amount: Math.round(amount), angle: Math.atan2(fromY - target.y, fromX - target.x) });
    if (target.extraction) this.room.extraction.cancel(target, 'Took damage');

    if (target.hp <= 0) {
      target.hp = 0;
      this.room.killPlayer(target, attacker && attacker !== target ? attacker : null, weaponId);
    }
  }
}
