import { ITEMS, WEAPONS, reloadDuration } from '@extract/game-config';
import { WEAPON_IDS, type WeaponDefinition } from '@extract/game-types';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { createWeaponRuntime, equipWeaponRuntime, shotAngles, stepWeapon, weaponPhase, weaponSpread, type FireInput } from '../src/weapons';

const DT = 1000 / 30;

/** Runs `steps` fixed steps; `trigger(i)` decides the trigger per step. Returns the step index of every round. */
function simulate(def: WeaponDefinition, steps: number, trigger: (i: number) => boolean, extra: Partial<FireInput> = {}) {
  const rt = createWeaponRuntime();
  equipWeaponRuntime(rt, 'w', def);
  const out: number[] = [];
  const shots: number[] = [];
  const spreads: number[] = [];
  let ammo = extra.ammo ?? 10_000;
  for (let i = 0; i < steps; i++) {
    const n = stepWeapon(rt, def, { trigger: trigger(i), moving: false, dashing: false, canFire: true, ...extra, ammo }, DT, out);
    for (let k = 0; k < n; k++) {
      shots.push(i);
      spreads.push(out[k]!);
    }
    ammo -= n;
  }
  return { rt, shots, spreads };
}

describe('weapon definitions', () => {
  it('has the full arsenal with complete, sane stats', () => {
    expect(WEAPON_IDS.length).toBeGreaterThanOrEqual(12);
    for (const id of WEAPON_IDS) {
      const d = WEAPONS[id];
      expect(d.id).toBe(id);
      expect(ITEMS[d.itemId]?.type).toBe('WEAPON');
      expect(ITEMS[d.itemId]!.rarity).toBe(d.rarity);
      expect(d.fireIntervalMs).toBeCloseTo(60_000 / d.fireRate);
      expect(d.spreadMoving).toBeGreaterThanOrEqual(d.spreadStanding);
      expect(d.range / d.projectileSpeed).toBeLessThan(1.5); // projectile lifetime
      expect(d.visual.muzzleDistance).toBeGreaterThan(30);
      expect(d.audio.fire.length).toBeGreaterThan(0);
      if (d.fireMode === 'BURST') expect(d.burstCount).toBeGreaterThan(1);
      if (d.reloadStyle === 'SHELL') expect(d.shellReloadMs).toBeGreaterThan(0);
    }
  });

  it('keeps time-to-kill in a reactable band (no armour, all rounds hit, close range)', () => {
    for (const id of WEAPON_IDS) {
      const d = WEAPONS[id];
      const perShot = d.damage * d.pelletCount;
      const shots = Math.ceil(100 / perShot);
      const rounds = d.fireMode === 'BURST' ? d.burstCount : 1;
      const cycles = Math.ceil(shots / rounds) - 1;
      const ttk = cycles * d.fireIntervalMs + ((shots - 1) % rounds) * d.burstDelayMs;
      if (d.category === 'SHOTGUN' && d.fireMode === 'SEMI') {
        // Pump shotgun: a point-blank one-shot needs every pellet inside the full-damage range.
        expect(shots).toBe(1);
        expect(d.falloff.startRange).toBeLessThanOrEqual(120);
        continue;
      }
      expect(shots, id).toBeGreaterThanOrEqual(2); // nothing else one-shots
      expect(ttk, id).toBeGreaterThanOrEqual(400);
      expect(ttk, id).toBeLessThanOrEqual(1400);
    }
    // Assault rifle: 5-7 clean hits.
    const ar = Math.ceil(100 / WEAPONS.assault_rifle.damage);
    expect(ar).toBeGreaterThanOrEqual(5);
    expect(ar).toBeLessThanOrEqual(7);
  });

  it('does not let the pump shotgun kill at range', () => {
    const d = WEAPONS.shotgun;
    const far = d.damage * d.pelletCount * d.falloff.minMultiplier;
    expect(far).toBeLessThan(25);
  });

  it('computes reload times per style', () => {
    const ar = WEAPONS.assault_rifle;
    expect(reloadDuration(ar, 0, 100)).toBe(ar.reloadMs);
    expect(reloadDuration(ar, 10, 100)).toBe(ar.tacticalReloadMs);
    expect(reloadDuration(ar, ar.magazineSize, 100)).toBe(0);
    expect(reloadDuration(ar, 0, 0)).toBe(0);
    const sg = WEAPONS.shotgun;
    expect(reloadDuration(sg, 4, 100)).toBe(sg.reloadMs + 2 * sg.shellReloadMs);
    expect(reloadDuration(sg, 4, 1)).toBe(sg.reloadMs + sg.shellReloadMs);
  });
});

describe('weapon controller', () => {
  it('fires AUTO weapons at their exact cyclic rate', () => {
    for (const id of ['smg', 'assault_rifle', 'lmg', 'suppressed_smg'] as const) {
      const d = WEAPONS[id];
      const { shots } = simulate(d, 90, () => true); // 3 s
      const expected = 3000 / d.fireIntervalMs;
      expect(Math.abs(shots.length - expected), id).toBeLessThanOrEqual(1.5);
    }
  });

  it('does not bank time while idle: the first two rounds are one interval apart', () => {
    const d = WEAPONS.smg;
    const { shots } = simulate(d, 20, (i) => i >= 5);
    expect((shots[1]! - shots[0]!) * DT).toBeGreaterThanOrEqual(d.fireIntervalMs - DT);
  });

  it('SEMI fires once per trigger pull and caps mashing at the fire rate', () => {
    const d = WEAPONS.basic_pistol;
    expect(simulate(d, 60, () => true).shots).toHaveLength(1);
    const mashed = simulate(d, 60, (i) => i % 2 === 0).shots.length; // 2 s
    expect(mashed).toBeLessThanOrEqual(Math.ceil(2000 / d.fireIntervalMs) + 1);
    expect(mashed).toBeGreaterThanOrEqual(Math.floor(2000 / d.fireIntervalMs) - 1);
  });

  it('buffers a pull that arrives just before the weapon is ready', () => {
    const d = WEAPONS.heavy_pistol;
    const readyAt = Math.ceil(d.fireIntervalMs / DT);
    // Second pull 2 steps early (within the buffer window) still fires.
    const { shots } = simulate(d, 40, (i) => i === 0 || i === readyAt - 2);
    expect(shots).toHaveLength(2);
  });

  it('BURST fires exactly burstCount rounds per pull, spaced by the burst delay', () => {
    const d = WEAPONS.burst_rifle;
    const { shots } = simulate(d, 30, (i) => i < 3);
    expect(shots).toHaveLength(d.burstCount);
    for (let i = 1; i < shots.length; i++) expect((shots[i]! - shots[i - 1]!) * DT).toBeCloseTo(d.burstDelayMs, -1);
  });

  it('stops a burst when the magazine runs dry and flags the dry pull', () => {
    const d = WEAPONS.burst_rifle;
    expect(simulate(d, 30, (i) => i === 0, { ammo: 2 }).shots).toHaveLength(2);
    const rt = createWeaponRuntime();
    equipWeaponRuntime(rt, 'w', d);
    stepWeapon(rt, d, { trigger: true, moving: false, dashing: false, canFire: true, ammo: 0 }, DT, []);
    expect(rt.dry).toBe(true);
    expect(weaponPhase(rt, d, { dead: false, reloading: false, mag: 0 })).toBe('EMPTY');
  });

  it('blooms under sustained fire and recovers afterwards (LMG grows the most)', () => {
    const lmg = WEAPONS.lmg;
    const { rt, spreads } = simulate(lmg, 60, () => true);
    expect(spreads[spreads.length - 1]!).toBeGreaterThan(spreads[0]! * 3);
    for (let i = 0; i < 120; i++) stepWeapon(rt, lmg, { trigger: false, moving: false, dashing: false, canFire: true, ammo: 100 }, DT, []);
    expect(rt.bloom).toBe(0);
  });

  it('punishes moving and dashing with more spread', () => {
    const d = WEAPONS.marksman_rifle;
    const standing = simulate(d, 20, () => false).rt;
    const moving = simulate(d, 20, () => false, { moving: true }).rt;
    const dashing = simulate(d, 20, () => false, { dashing: true }).rt;
    expect(weaponSpread(moving, d)).toBeGreaterThan(weaponSpread(standing, d) * 10);
    expect(weaponSpread(dashing, d)).toBeGreaterThan(weaponSpread(moving, d));
  });

  it('cannot fire while raising a swapped weapon (the first weapon is already in hand)', () => {
    const d = WEAPONS.assault_rifle;
    const rt = createWeaponRuntime();
    equipWeaponRuntime(rt, 'a', WEAPONS.basic_pistol);
    expect(rt.equipLeftMs).toBe(0);
    equipWeaponRuntime(rt, 'b', d);
    expect(weaponPhase(rt, d, { dead: false, reloading: false, mag: 30 })).toBe('SWITCHING');
    let first = -1;
    for (let i = 0; i < 40 && first < 0; i++) {
      if (stepWeapon(rt, d, { trigger: true, moving: false, dashing: false, canFire: true, ammo: 30 }, DT, [])) first = i;
    }
    expect(first * DT).toBeGreaterThanOrEqual(d.equipMs - DT);
  });

  it('never fires while it cannot (reload / item use) and does not dump rounds afterwards', () => {
    const d = WEAPONS.smg;
    const rt = createWeaponRuntime();
    equipWeaponRuntime(rt, 'w', d);
    const blocked = { trigger: true, moving: false, dashing: false, canFire: false, ammo: 30 };
    for (let i = 0; i < 30; i++) expect(stepWeapon(rt, d, blocked, DT, [])).toBe(0);
    expect(stepWeapon(rt, d, { ...blocked, canFire: true }, DT, [])).toBe(1);
  });

  it('fans shotgun pellets into a readable pattern inside spread + pellet spread', () => {
    const d = WEAPONS.shotgun;
    const rng = new Rng(3);
    const out: number[] = [];
    for (let k = 0; k < 200; k++) {
      shotAngles(d, 1, d.spreadStanding, () => rng.next(), out);
      expect(out).toHaveLength(d.pelletCount);
      for (const a of out) expect(Math.abs(a - 1)).toBeLessThanOrEqual(d.spreadStanding + d.pelletSpread * (1 + 1 / d.pelletCount) + 1e-9);
      // Ordered fan: pellets never all bunch on one side.
      expect(out[0]!).toBeLessThan(out[out.length - 1]!);
    }
  });
});
