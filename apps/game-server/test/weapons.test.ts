import { WEAPONS } from '@extract/game-config';
import { INPUT_BUTTONS, type WeaponId } from '@extract/game-types';
import { describe, expect, it } from 'vitest';
import { engagementScore } from '../src/bots/BotBrain';
import { computeDamage } from '../src/game/combat/damage';
import type { ServerPlayer } from '../src/game/entities/ServerPlayer';
import { createWeapon } from '../src/game/inventory/RaidInventory';
import type { MatchRoom } from '../src/game/match/MatchRoom';
import { openLane, place, startedRoomWithTwo, tickFor } from './helpers';

const FIRE = INPUT_BUTTONS.FIRE;

let seq = 1000;

/** Equips a weapon and waits out its raise time (the controller advances with inputs). */
function arm(room: MatchRoom, p: ServerPlayer, id: WeaponId): void {
  step(room, p, false);
  room.handleDev(p, { cmd: 'giveWeapon', weaponId: id });
  for (let i = 0; i < Math.ceil(WEAPONS[id].equipMs / (1000 / 30)) + 2; i++) step(room, p, false);
}

function step(room: MatchRoom, p: ServerPlayer, fire: boolean, a = 0): void {
  room.handleInputs(p, [{ s: ++seq, mx: 0, my: 0, a, b: fire ? FIRE : 0 }]);
  room.tick();
}

describe('combat 2.0', () => {
  it('a burst rifle pull fires exactly one burst', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    arm(room, p1, 'burst_rifle');
    const w = p1.inventory.activeWeapon()!;
    const before = w.mag;
    step(room, p1, true);
    step(room, p1, true);
    for (let i = 0; i < 20; i++) step(room, p1, true); // still holding: no second burst
    expect(before - w.mag).toBe(WEAPONS.burst_rifle.burstCount);
  });

  it('shotgun fires a pellet pattern and reloads shell by shell; the trigger interrupts', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    arm(room, p1, 'shotgun');
    const def = WEAPONS.shotgun;
    const w = p1.inventory.activeWeapon()!;
    const lane = openLane(room, 300);
    place(room, p1, lane.ax, lane.ay);
    step(room, p1, true);
    expect(room.world.bullets.filter((b) => b.ownerId === p1.id)).toHaveLength(def.pelletCount);
    for (let i = 0; i < 30; i++) step(room, p1, false); // pump cycle (cooldown advances with inputs)
    step(room, p1, true);
    step(room, p1, false);
    expect(w.mag).toBe(def.magazineSize - 2);

    room.handleAction(p1, { k: 'reload' });
    expect(p1.reload).not.toBeNull();
    for (let i = 0; i < Math.ceil((def.reloadMs + def.shellReloadMs + 40) / (1000 / 30)); i++) step(room, p1, false);
    expect(w.mag).toBe(def.magazineSize - 1); // one shell in, reload continues
    expect(p1.reload).not.toBeNull();
    step(room, p1, true); // interrupt by firing
    expect(p1.reload).toBeNull();
    expect(w.mag).toBe(def.magazineSize - 2);
  });

  it('tactical reloads are faster than empty reloads', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    arm(room, p1, 'assault_rifle');
    const w = p1.inventory.activeWeapon()!;
    w.mag = 5;
    room.handleAction(p1, { k: 'reload' });
    expect(p1.reload!.totalMs).toBe(WEAPONS.assault_rifle.tacticalReloadMs);
    tickFor(room, WEAPONS.assault_rifle.tacticalReloadMs + 50);
    expect(w.mag).toBe(WEAPONS.assault_rifle.magazineSize);
    w.mag = 0;
    room.handleAction(p1, { k: 'reload' });
    expect(p1.reload!.totalMs).toBe(WEAPONS.assault_rifle.reloadMs);
  });

  it('the void rifle pierces one target; normal rounds stop at the first', async () => {
    const { room, p1, p2 } = await startedRoomWithTwo();
    const p3 = room.addHuman('Carol', 'user-carol', new (await import('./helpers')).FakeChannel());
    tickFor(room, 100);
    const lane = openLane(room, 200);
    place(room, p1, lane.ax, lane.ay);
    place(room, p2, lane.ax + 90, lane.ay);
    place(room, p3, lane.ax + 180, lane.ay);
    arm(room, p1, 'void_rifle');
    step(room, p1, true, 0);
    tickFor(room, 200);
    expect(p2.hp).toBeLessThan(100);
    expect(p3.hp).toBeLessThan(100);
    expect(100 - p3.hp).toBeLessThan(100 - p2.hp); // reduced after piercing

    p2.hp = 100;
    p3.hp = 100;
    arm(room, p1, 'assault_rifle');
    step(room, p1, true, 0);
    step(room, p1, false, 0);
    tickFor(room, 200);
    expect(p2.hp).toBeLessThan(100);
    expect(p3.hp).toBe(100);
  });

  it('armor-piercing weapons strip armor faster for the same absorbed damage', () => {
    const normal = computeDamage(40, 100, 0.5, 1);
    const ap = computeDamage(40, 100, 0.5, WEAPONS.marksman_rifle.armorDamageMultiplier);
    expect(ap.healthDamage).toBe(normal.healthDamage);
    expect(ap.armorDamage).toBeGreaterThan(normal.armorDamage);
    // Nearly empty armor absorbs proportionally less.
    const thin = computeDamage(40, 5, 0.5, 2);
    expect(thin.armorDamage).toBeCloseTo(5);
    expect(thin.healthDamage).toBeCloseTo(37.5);
  });

  it('switching weapons blocks fire for the raise time and cancels reloads', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    p1.inventory.equipWeapon(createWeapon('lmg'));
    p1.inventory.addAmmo('rifle', 200);
    p1.inventory.activeSlot = 0;
    step(room, p1, false); // pistol in hand
    room.handleAction(p1, { k: 'switch', slot: 1 });
    const w = p1.inventory.activeWeapon()!;
    const before = w.mag;
    const steps = Math.floor(WEAPONS.lmg.equipMs / (1000 / 30)) - 2;
    for (let i = 0; i < steps; i++) step(room, p1, true);
    expect(w.mag).toBe(before);
    for (let i = 0; i < 10; i++) step(room, p1, true);
    expect(w.mag).toBeLessThan(before);
  });

  it('dev infinite ammo keeps the magazine full', async () => {
    const { room, p1 } = await startedRoomWithTwo();
    arm(room, p1, 'smg');
    room.handleDev(p1, { cmd: 'infiniteAmmo', on: true });
    for (let i = 0; i < 90; i++) step(room, p1, true);
    expect(p1.inventory.activeWeapon()!.mag).toBe(WEAPONS.smg.magazineSize);
  });

  it('bots rate shotguns best up close and the marksman rifle at range', () => {
    const close = (['shotgun', 'assault_rifle', 'marksman_rifle'] as const).map((id) => engagementScore(WEAPONS[id], 90));
    expect(close[0]).toBeGreaterThan(close[1]!);
    const far = (['shotgun', 'smg', 'marksman_rifle'] as const).map((id) => engagementScore(WEAPONS[id], 900));
    expect(far[2]).toBeGreaterThan(far[0]!);
    expect(far[2]).toBeGreaterThan(far[1]!);
  });
});
