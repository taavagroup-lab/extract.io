import { PLAYER_CONFIG, WEAPONS, reloadDuration, weaponIndex } from '@extract/game-config';
import { INPUT_BUTTONS, type InputCmd, type WeaponDefinition, type WeaponId } from '@extract/game-types';
import { equipWeaponRuntime, moveParamsFor, sanitizeAxis, segmentCircle, shotAngles, stepWeapon, type MoveParams } from '@extract/shared';
import { bulletDamage, computeDamage } from '../combat/damage';
import type { ServerPlayer } from '../entities/ServerPlayer';
import type { Bullet } from '../entities/types';
import type { MatchRoom } from '../match/MatchRoom';

const HIT_QUERY_PAD = PLAYER_CONFIG.radius + 4;
/** Damage kept by a round after passing through a player. */
const PIERCE_DAMAGE = 0.6;

/**
 * Server-authoritative shooting: the shared weapon controller decides when
 * rounds fire (fire modes, bursts, bloom), this system owns ammo, reloads,
 * projectile simulation, hit detection, damage and kill attribution.
 */
export class CombatSystem {
  private readonly hitCandidates: ServerPlayer[] = [];
  private readonly spreads: number[] = [];
  private readonly angles: number[] = [];
  private readonly rand = (): number => this.room.rng.next();

  constructor(private readonly room: MatchRoom) {}

  canAct(p: ServerPlayer): boolean {
    return p.status === 'ALIVE' || p.status === 'EXTRACTING';
  }

  /** Movement parameters for the equipped weapon (speed multiplier). */
  moveParams(p: ServerPlayer): MoveParams {
    return moveParamsFor(p.activeWeaponDef());
  }

  /**
   * One fixed input step of the trigger. Runs for every processed input
   * (not only while firing) so semi-auto trigger resets, bursts and bloom
   * recovery advance exactly like the client prediction.
   */
  stepFire(p: ServerPlayer, input: InputCmd, dtMs: number): void {
    const rt = p.weapon;
    const trigger = (input.b & INPUT_BUTTONS.FIRE) !== 0;
    const weapon = p.inventory.activeWeapon();
    if (!weapon) {
      rt.triggerHeld = trigger;
      return;
    }
    const def = WEAPONS[weapon.weaponId];
    if (rt.key !== weapon.uid) equipWeaponRuntime(rt, weapon.uid, def);

    // Pulling the trigger with rounds loaded interrupts a reload.
    if (p.reload && trigger && !rt.triggerHeld && weapon.mag > 0) p.reload = null;

    const moving = sanitizeAxis(input.mx) !== 0 || sanitizeAxis(input.my) !== 0;
    const canFire = this.canAct(p) && !p.use && !p.reload;
    const n = stepWeapon(rt, def, { trigger, moving, dashing: p.move.dashTime > 0, ammo: weapon.mag, canFire }, dtMs, this.spreads);
    for (let i = 0; i < n; i++) this.fireRound(p, def, this.spreads[i]!);
    if (p.devInfiniteAmmo) weapon.mag = def.magazineSize;
    if (weapon.mag === 0 && (n > 0 || rt.dry)) this.startReload(p);
  }

  private fireRound(p: ServerPlayer, def: WeaponDefinition, spread: number): void {
    const weapon = p.inventory.activeWeapon()!;
    weapon.mag -= 1;
    const rng = this.room.rng;
    const pellets = def.pelletCount > 1;
    for (const angle of shotAngles(def, p.rotation, spread, this.rand, this.angles)) {
      const bullet: Bullet = {
        id: this.room.world.newId(),
        ownerId: p.id,
        weaponId: def.id,
        x: p.x,
        y: p.y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        speed: def.projectileSpeed * (pellets ? rng.range(0.92, 1.04) : 1),
        remaining: def.range,
        traveled: 0,
        damage: def.damage,
        pierce: def.pierce,
        ignoreId: -1,
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
  }

  startReload(p: ServerPlayer): void {
    if (!this.canAct(p) || p.reload) return;
    const weapon = p.inventory.activeWeapon();
    if (!weapon) return;
    const def = WEAPONS[weapon.weaponId];
    const reserve = p.devInfiniteAmmo ? def.magazineSize : p.inventory.ammo[def.ammoType];
    const total = reloadDuration(def, weapon.mag, reserve);
    if (total <= 0) return;
    const now = this.room.now;
    p.use = null;
    p.reload = {
      slot: p.inventory.activeSlot,
      // SHELL: the first round goes in after the start-up, then one per shellReloadMs.
      endsAt: now + (def.reloadStyle === 'SHELL' ? def.reloadMs + def.shellReloadMs : total),
      fullAt: now + total,
      totalMs: total,
    };
  }

  cancelReload(p: ServerPlayer): void {
    p.reload = null;
  }

  /** Completes reloads (or inserts the next shell) whose timer elapsed. */
  updateReload(p: ServerPlayer): void {
    const r = p.reload;
    if (!r || this.room.now < r.endsAt) return;
    const weapon = p.inventory.weapons[r.slot];
    if (!weapon || r.slot !== p.inventory.activeSlot) {
      p.reload = null;
      return;
    }
    const def = WEAPONS[weapon.weaponId];
    const ammo = p.inventory.ammo;
    if (p.devInfiniteAmmo) ammo[def.ammoType] = Math.max(ammo[def.ammoType], def.magazineSize);
    if (def.reloadStyle === 'SHELL') {
      if (weapon.mag < def.magazineSize && ammo[def.ammoType] > 0) {
        weapon.mag += 1;
        ammo[def.ammoType] -= 1;
      }
      if (weapon.mag < def.magazineSize && ammo[def.ammoType] > 0) r.endsAt += def.shellReloadMs;
      else p.reload = null;
      return;
    }
    p.reload = null;
    const take = Math.min(def.magazineSize - weapon.mag, ammo[def.ammoType]);
    weapon.mag += take;
    ammo[def.ammoType] -= take;
  }

  /** Swap: the raise time (per weapon) is enforced by the weapon controller. */
  switchWeapon(p: ServerPlayer, slot: number): void {
    if (!this.canAct(p) || slot === p.inventory.activeSlot || !p.inventory.weapons[slot]) return;
    p.inventory.activeSlot = slot;
    p.reload = null;
    p.use = null;
  }

  updateBullets(dt: number): void {
    const world = this.room.world;
    const bullets = world.bullets;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i] as Bullet;
      let budget = Math.min(b.speed * dt, b.remaining);
      let alive = true;
      // A piercing round can hit several targets in one tick: loop over segments.
      for (let seg = 0; seg < 4 && budget > 0.001; seg++) {
        const ex = b.x + b.dirX * budget;
        const ey = b.y + b.dirY * budget;
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
          if (target.id === b.ownerId || target.id === b.ignoreId || !target.inWorld) continue;
          const t = segmentCircle(b.x, b.y, dx, dy, target.x, target.y, PLAYER_CONFIG.radius);
          if (t !== null && t < hitT) {
            hitT = t;
            hitPlayer = target;
          }
        }

        if (!hitPlayer && !wall) {
          b.x = ex;
          b.y = ey;
          b.remaining -= budget;
          b.traveled += budget;
          budget = 0;
          break;
        }
        const t = Math.min(hitT, 1);
        const hx = b.x + dx * t;
        const hy = b.y + dy * t;
        const step = budget * t;
        if (hitPlayer) {
          const owner = world.players.get(b.ownerId) ?? null;
          const def = WEAPONS[b.weaponId];
          const dmg = bulletDamage(b.damage, b.traveled + step, def.falloff);
          this.applyDamage(hitPlayer, dmg, owner, b.weaponId, b.x, b.y, def.armorDamageMultiplier);
          if (b.pierce > 0) {
            // Pass through: keep flying from the hit point with reduced damage.
            this.room.bulletEnds.push([b.id, Math.round(hx), Math.round(hy), 2]);
            b.pierce--;
            b.damage *= PIERCE_DAMAGE;
            b.ignoreId = hitPlayer.id;
            b.x = hx;
            b.y = hy;
            b.traveled += step;
            b.remaining -= step;
            budget -= step;
            continue;
          }
        }
        this.room.bulletEnds.push([b.id, Math.round(hx), Math.round(hy), hitPlayer ? 1 : 0]);
        alive = false;
        break;
      }
      if (!alive || b.remaining <= 0.001) {
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
    armorMultiplier = 1,
  ): void {
    if (!target.inWorld || amount <= 0) return;
    const { healthDamage, armorDamage } = computeDamage(amount, target.armor, undefined, armorMultiplier);
    target.armor = Math.max(0, target.armor - armorDamage);
    target.hp -= healthDamage;
    target.lastDamagedAt = this.room.now;
    const killed = target.hp <= 0;
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
        ...(killed ? { killed: true } : {}),
      });
    }
    this.room.emitTo(target, { e: 'hurt', amount: Math.round(amount), angle: Math.atan2(fromY - target.y, fromX - target.x), armor: armorDamage > 0 });
    if (target.extraction) this.room.extraction.cancel(target, 'Took damage');

    if (killed) {
      target.hp = 0;
      this.room.killPlayer(target, attacker && attacker !== target ? attacker : null, weaponId);
    }
  }
}
