import { RARITY_CONFIG, WEAPONS } from '@extract/game-config';
import type { WeaponId } from '@extract/game-types';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from '../geometry';
import { glow, mat } from '../materials';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14);
const hexCyl = new THREE.CylinderGeometry(1, 1, 1, 6);
const torusGeo = new THREE.TorusGeometry(1, 0.28, 8, 20);

const rounded = new Map<string, THREE.BufferGeometry>();
/** Rounded box with a real (unscaled) bevel radius, cached by size. */
function rbox(w: number, h: number, d: number, r = 0.9): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}|${r}`;
  let g = rounded.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
    rounded.set(key, g);
  }
  return g;
}

export interface WeaponModel {
  group: THREE.Group;
  /** Muzzle position along +X from the grip (model units). */
  muzzle: number;
  /** Height of the bore above the grip origin. */
  bore: number;
  /** Ejection port (x along the gun); casings leave towards -Z. */
  eject: number;
  /** Where the support hand sits (x); ~0 = both hands on the grip (pistols). */
  support: number;
  /** Detachable magazine (reload animation), if any. */
  mag: THREE.Object3D | null;
  /** Pump fore-end / bolt handle (cycles after a shot). */
  action: THREE.Object3D | null;
}

interface Template {
  group: THREE.Group;
  muzzle: number;
  bore: number;
  eject: number;
  support: number;
}

/**
 * Parts builder: every part is a mesh placed in weapon space (+X forward,
 * +Y up, grip at the origin). Names mark animated parts.
 */
class Kit {
  readonly g = new THREE.Group();

  add(geo: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0], name?: string): THREE.Mesh {
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.rotation.set(...rot);
    m.castShadow = true;
    if (name) m.name = name;
    this.g.add(m);
    return m;
  }

  /** Rounded block centred at x (from x0 to x1). */
  block(material: THREE.Material, x0: number, x1: number, y: number, h: number, d: number, r = 0.9, name?: string, z = 0): THREE.Mesh {
    return this.add(rbox(x1 - x0, h, d, r), material, [(x0 + x1) / 2, y, z], [1, 1, 1], [0, 0, 0], name);
  }

  /** Cylinder along X from x0 to x1. */
  tube(material: THREE.Material, x0: number, x1: number, y: number, radius: number, z = 0, hex = false): THREE.Mesh {
    return this.add(hex ? hexCyl : unitCyl, material, [(x0 + x1) / 2, y, z], [radius, x1 - x0, radius], [0, 0, Math.PI / 2]);
  }

  box(material: THREE.Material, pos: [number, number, number], size: [number, number, number], rotZ = 0, name?: string): THREE.Mesh {
    return this.add(unitBox, material, pos, size, [0, 0, rotZ], name);
  }

  /** Pistol grip: angled, slightly flared. */
  grip(material: THREE.Material, x = 0, len = 7.5, angle = 0.28): void {
    this.add(rbox(5.6, len, 4.2, 1.2), material, [x - 0.8, -len / 2 + 1.2, 0], [1, 1, 1], [0, 0, angle]);
  }

  /** Optic housing with a lens that glows. */
  optic(body: THREE.Material, lens: THREE.Material, x0: number, x1: number, y: number, radius: number): void {
    this.tube(body, x0, x1, y, radius);
    this.tube(body, x1 - 1.2, x1 + 0.6, y, radius * 1.28);
    this.tube(body, x0 - 0.6, x0 + 1.2, y, radius * 1.15);
    this.add(unitCyl, lens, [x1 + 0.7, y, 0], [radius * 1.1, 0.2, radius * 1.1], [0, 0, Math.PI / 2]);
    this.box(body, [(x0 + x1) / 2, y - radius - 0.8, 0], [4, 1.6, 2.4]);
  }

  done(muzzle: number, bore: number, eject: number, support: number): Template {
    // One draw call per material; animated parts stay separate meshes.
    mergeStatic(this.g, (m) => m.name === 'mag' || m.name === 'pump' || m.name === 'bolt');
    return { group: this.g, muzzle, bore, eject, support };
  }
}

function build(id: WeaponId): Template {
  const def = WEAPONS[id];
  const rank = RARITY_CONFIG[def.rarity].rank;
  const k = new Kit();

  // Palette: dark metal + polymer, per-weapon furniture colour.
  const blk = mat(0x1b1e22, { rough: 0.34, metal: 0.8 });
  const steel = mat(0x4a5059, { rough: 0.26, metal: 0.92 });
  const brightSteel = mat(0x9aa2ad, { rough: 0.22, metal: 0.95 });
  const poly = mat(0x262a30, { rough: 0.7 });
  const tan = mat(0x8a7653, { rough: 0.72 });
  const olive = mat(0x4f5838, { rough: 0.75 });
  const wood = mat(0x6a4526, { rough: 0.6 });
  const graphite = mat(0x34383f, { rough: 0.55, metal: 0.3 });
  const lens = glow(0xff4d5e, 1, null, 3);
  const lensBlue = glow(0x5ad1ff, 1, null, 2.6);
  const rarity = RARITY_CONFIG[def.rarity].colorHex;
  // Rarity reads only as a thin trim: faint glow for EPIC, blooming for LEGENDARY+, painted for RARE, none for COMMON.
  const accent = rank >= 3 ? glow(rarity, 1, null, 1.6) : rank === 2 ? glow(rarity, 1, null, 1.05) : rank === 1 ? mat(rarity, { rough: 0.45, metal: 0.4 }) : null;
  const trim = (x0: number, x1: number, y: number, d: number) => {
    if (accent) k.box(accent, [(x0 + x1) / 2, y, 0], [x1 - x0, 0.6, d]);
  };

  switch (id) {
    case 'basic_pistol': {
      k.grip(poly, 0, 7.5);
      k.block(poly, -2.6, 13.5, 0.6, 3, 4.2, 0.8); // frame + trigger guard
      k.box(poly, [3.2, -1.6, 0], [4, 1.2, 1.2]);
      k.block(blk, -3.2, 15, 3.4, 4.2, 4.5, 0.9); // slide
      for (let i = 0; i < 4; i++) k.box(steel, [-1.6 + i * 1.1, 3.4, 0], [0.4, 4.3, 4.6]); // serrations
      k.box(steel, [-2.4, 5.8, 0], [1.2, 0.9, 3]);
      k.tube(steel, 14.5, 15.8, 3.1, 1.1);
      k.box(poly, [-1, -6.4, 0], [4.6, 1.5, 3.8], 0.28, 'mag');
      return k.done(16, 3.1, 5, 0);
    }
    case 'heavy_pistol': {
      k.grip(wood, 0, 8.4, 0.24);
      k.block(blk, -2.8, 15, 0.8, 3.4, 4.6, 0.8);
      k.block(brightSteel, -3.6, 20.4, 4, 5.2, 5.4, 1); // big stainless slide
      for (let i = 0; i < 3; i++) k.box(blk, [15 + i * 1.8, 6.7, 0], [0.9, 0.4, 2.6]); // ported top
      k.box(blk, [-2.6, 6.8, 0], [1.6, 1, 3.4]);
      k.box(blk, [18.6, 6.8, 0], [1, 1, 1.2]);
      k.tube(blk, 19.8, 21.2, 3.6, 1.6);
      k.box(blk, [-1, -7, 0], [5, 1.6, 4.2], 0.24, 'mag');
      trim(-3, 12, 1.4, 4.7);
      return k.done(21, 3.6, 6, 0);
    }
    case 'smg': {
      k.grip(poly, 0, 7);
      k.block(poly, -4, 18, 1.5, 7, 5.4, 1.2); // receiver
      k.box(tan, [8.5, -5.8, 0], [4.4, 12, 3.6], -0.05, 'mag'); // straight tan mag
      k.box(poly, [15, -3.2, 0], [2.6, 6, 2.6]); // vertical grip
      k.tube(blk, 18, 24, 2.2, 1.7);
      k.tube(steel, 23.6, 26.4, 2.2, 2, 0, true); // muzzle device
      k.block(blk, -13, -4, 1.2, 3, 2, 0.6, undefined, 2.8); // folded stock (reads on the left)
      k.box(blk, [-12.6, 1.2, 1], [1.4, 3, 5.4]);
      k.box(blk, [7, 6.2, 0], [7, 3, 3.2]); // red dot
      k.box(lens, [10.6, 6.4, 0], [0.3, 1.6, 1.8]);
      trim(0, 14, 5.1, 5.6);
      return k.done(26.5, 2.2, 7, 15);
    }
    case 'suppressed_smg': {
      k.grip(olive, 0, 7);
      k.block(olive, -4, 15, 1.6, 6.6, 5.2, 1.1);
      k.box(blk, [7.5, -5.2, 0], [4, 10.5, 3.4], 0.05, 'mag');
      k.tube(blk, 14, 34, 2.4, 3.3); // integral suppressor: fat, long, dark
      k.tube(steel, 33.4, 34.2, 2.4, 2.4);
      for (let i = 0; i < 3; i++) k.tube(graphite, 17 + i * 5.5, 18 + i * 5.5, 2.4, 3.45);
      // Skeleton stock.
      k.box(blk, [-10, 3, 0], [12, 1.2, 1.4]);
      k.box(blk, [-10, -0.6, 0], [12, 1.2, 1.4], 0.12);
      k.box(poly, [-16, 1.2, 0], [1.8, 6.4, 4.4]);
      k.box(blk, [6, 5.9, 0], [8, 2.2, 3]);
      k.box(lensBlue, [10.1, 6, 0], [0.3, 1.4, 1.6]);
      trim(-2, 12, 5, 5.4);
      return k.done(34.4, 2.4, 6, 16);
    }
    case 'assault_rifle': {
      k.grip(poly, 0, 7.4);
      k.block(tan, -18, -5, 0.8, 6.2, 4.4, 1.2); // stock
      k.box(poly, [-18.2, 0.6, 0], [1.4, 7, 4.8]); // butt pad
      k.box(blk, [-6, 2, 0], [4, 2.6, 2.6]); // buffer tube
      k.block(blk, -4, 16, 1.8, 7, 5.2, 1); // receiver
      k.block(tan, 15.6, 30, 1.9, 5.8, 5.6, 1.4); // handguard
      k.box(blk, [11, -5.8, 0], [4.2, 12, 3.6], -0.24, 'mag'); // curved mag
      k.tube(blk, 30, 38, 2, 1.45);
      k.tube(steel, 37.6, 42, 2, 2.1, 0, true); // brake
      k.box(blk, [14, 5.5, 0], [30, 1.1, 3]); // top rail
      k.optic(blk, lens, 4, 12, 8, 2.3);
      trim(18, 28, 4.9, 5.8);
      return k.done(42.2, 2, 8, 24);
    }
    case 'burst_rifle': {
      // Bullpup: magazine behind the grip, compact overall length.
      const gray = mat(0x5b6470, { rough: 0.55, metal: 0.2 });
      k.grip(blk, 0, 7);
      k.block(gray, -21, 10, 1.6, 7.6, 5.8, 1.6); // body with integrated stock
      k.box(blk, [-21.2, 1.4, 0], [1.4, 8, 6]);
      k.box(blk, [-9, -5.2, 0], [4.2, 10, 3.6], -0.1, 'mag');
      k.block(blk, 10, 26, 1.6, 5.4, 5, 1.2); // handguard
      k.tube(blk, 26, 34, 1.8, 1.4);
      k.tube(steel, 33.6, 36.4, 1.8, 1.9);
      // Carry-handle optic.
      k.box(gray, [4, 7.2, 0], [18, 2.4, 3.2]);
      k.box(blk, [-4, 5.8, 0], [2.4, 2, 2.6]);
      k.box(blk, [12, 5.8, 0], [2.4, 2, 2.6]);
      k.box(lensBlue, [13.3, 7.2, 0], [0.3, 1.6, 2]);
      trim(-18, 6, 5.5, 6);
      return k.done(36.6, 1.8, -4, 18);
    }
    case 'battle_rifle': {
      k.grip(blk, 0, 7.6);
      k.block(olive, -20, -4, 0.8, 7, 4.8, 1.4); // stock
      k.box(blk, [-20.3, 0.8, 0], [1.4, 7.6, 5]);
      k.block(blk, -4, 18, 1.8, 7.4, 5.6, 1.1);
      k.block(olive, 17.6, 32, 1.9, 6, 6, 1.4);
      k.box(blk, [11, -6.6, 0], [5.2, 12.5, 4.2], -0.06, 'mag'); // big box mag
      k.tube(blk, 32, 44, 2, 1.7);
      k.tube(steel, 43.6, 49, 2, 2.7, 0, true); // big brake
      for (const x of [45, 47]) k.box(blk, [x, 2, 0], [0.6, 2, 5.8]);
      k.box(blk, [12, 5.7, 0], [22, 1.1, 3]);
      k.optic(blk, lens, 4, 13, 8.2, 2.1);
      trim(20, 30, 5.1, 6.2);
      return k.done(49.2, 2, 9, 26);
    }
    case 'shotgun': {
      k.grip(wood, 0, 7.2, 0.32);
      k.block(wood, -18, -4, 0.6, 6.4, 5, 1.6); // stock
      k.box(blk, [-18.4, 0.6, 0], [1.6, 7, 5.4]);
      k.block(blk, -4, 10.5, 1.4, 7, 5.6, 1);
      k.tube(blk, 10, 40, 3.1, 2.2); // barrel
      k.tube(steel, 10, 34, -0.8, 2.1); // tube magazine
      k.block(wood, 17, 29, -0.3, 4.6, 6.8, 1.8, 'pump'); // pump (animated)
      k.box(brightSteel, [39.4, 5.5, 0], [1.6, 1.2, 1.4]); // bead
      k.box(brightSteel, [4, 1.6, -2.9], [5, 2.2, 0.4]); // ejection port
      trim(-2, 8, 5.1, 5.8);
      return k.done(41, 3.1, 4, 23);
    }
    case 'auto_shotgun': {
      const orange = mat(0xc4581f, { rough: 0.6 });
      k.grip(blk, 0, 7.2);
      k.block(poly, -16, -4, 0.8, 6.4, 5, 1.4);
      k.block(blk, -4, 14.5, 1.8, 8, 6.6, 1.2); // bulky receiver
      k.add(unitCyl, blk, [7, -5, 0], [7, 5.4, 7], [Math.PI / 2, 0, 0], 'mag'); // drum (round from above)
      k.add(unitCyl, orange, [7, -5, 0], [3, 5.6, 3], [Math.PI / 2, 0, 0]);
      k.block(poly, 14, 26, 2, 6, 6, 1.4);
      k.tube(blk, 26, 32, 2.4, 2.1);
      k.block(steel, 31.4, 36, 2.4, 4.6, 4.6, 0.6); // square brake
      k.box(poly, [20, -3.6, 0], [2.8, 6, 2.8]);
      k.box(orange, [-2, 6, 0], [10, 1, 1.2]);
      trim(16, 25, 5.1, 6.2);
      return k.done(36.2, 2.4, 6, 20);
    }
    case 'marksman_rifle': {
      const green = mat(0x3d4a3a, { rough: 0.65 });
      k.grip(blk, 0, 7.6);
      k.block(green, -25, -4, 1, 6.6, 4.4, 1.2); // chassis stock
      k.box(green, [-14, 5, 0], [8, 2.2, 3.4]); // cheek riser
      k.box(blk, [-25.4, 1, 0], [1.6, 8, 5]);
      k.block(blk, -4, 14, 2, 6, 5, 1);
      k.block(green, 14, 26, 2, 5, 5, 1.2);
      k.tube(blk, 26, 54, 2.2, 1.35); // long barrel
      k.tube(steel, 53.6, 58, 2.2, 2.2, 0, true);
      k.optic(blk, lensBlue, -1, 17, 8.6, 3); // big scope
      k.box(steel, [-2, 2.6, -4.8], [1.6, 1.6, 5.2], 0, 'bolt'); // bolt handle to the side
      k.add(unitCyl, steel, [-2, 2.6, -7.4], [1.3, 1.3, 1.3], [Math.PI / 2, 0, 0]);
      k.box(blk, [7, -3.4, 0], [4.2, 5, 3.4], 0, 'mag');
      k.box(blk, [40, -0.6, 1.4], [12, 1, 1]); // folded bipod
      k.box(blk, [40, -0.6, -1.4], [12, 1, 1]);
      trim(16, 25, 4.6, 5.2);
      return k.done(58.2, 2.2, 3, 22);
    }
    case 'lmg': {
      k.grip(poly, 0, 7.6);
      k.block(tan, -20, -4, 1, 7, 5.2, 1.4);
      k.box(poly, [-20.3, 1, 0], [1.6, 7.6, 5.6]);
      k.block(blk, -4, 20, 2.4, 8.4, 7, 1.2); // big receiver
      k.box(steel, [8, 6.9, 0], [14, 1, 6.4]); // feed cover
      k.block(tan, 2, 13, -2.6, 9, 7.2, 1.2, 'mag', 6.4); // ammo box on the left side
      k.box(brightSteel, [7.5, 1.6, 3.2], [7, 1.2, 1.4]); // belt
      k.tube(blk, 20, 40, 2.4, 1.8);
      k.tube(graphite, 20, 34, 2.4, 2.7); // heat shield
      for (let i = 0; i < 5; i++) k.tube(blk, 21.5 + i * 2.6, 22.3 + i * 2.6, 2.4, 2.8);
      k.tube(steel, 39.6, 46, 2.4, 2.1, 0, true); // flash hider
      k.box(blk, [22, 8, 0], [7, 1.2, 1.6]); // carry handle
      k.box(blk, [37, -2, 1.6], [1, 7, 1], 0.5); // bipod legs
      k.box(blk, [37, -2, -1.6], [1, 7, 1], 0.5);
      trim(-2, 18, 6.7, 7.2);
      return k.done(46.2, 2.4, 10, 26);
    }
    case 'void_rifle': {
      const shell = mat(0xd9dde4, { rough: 0.35, metal: 0.2 });
      const core = glow(def.visual.accent ?? 0xa35cff, 1, null, 3.2);
      k.grip(graphite, 0, 7.2);
      k.block(shell, -17, -3, 1.2, 6.4, 4.6, 2); // stock shell
      k.block(graphite, -3, 20, 2, 7.2, 5.6, 1.8); // body
      k.block(shell, 2, 22, 5.2, 2.6, 5, 1.2); // top shell
      k.block(core, 4, 12, -2.8, 4.2, 3.6, 1.2, 'mag'); // energy cell (glows)
      k.tube(graphite, 20, 38, 2, 1.5);
      for (let i = 0; i < 3; i++) k.add(torusGeo, core, [24 + i * 5, 2, 0], [2.6, 2.6, 2.6], [0, Math.PI / 2, 0]); // coils
      k.block(shell, 37, 42, 2, 4, 4.4, 1.2); // emitter
      k.box(core, [42.1, 2, 0], [0.3, 2.2, 2.6]);
      k.box(core, [8, 6.6, 0], [14, 0.5, 1.2]);
      return k.done(42.4, 2, 7, 22);
    }
  }
}

const templates = new Map<WeaponId, Template>();

/** Returns a new instance (shared geometries/materials) of a weapon model. */
export function weaponModel(id: WeaponId): WeaponModel {
  let t = templates.get(id);
  if (!t) {
    t = build(id);
    templates.set(id, t);
  }
  const group = t.group.clone();
  return {
    group,
    muzzle: t.muzzle,
    bore: t.bore,
    eject: t.eject,
    support: t.support,
    mag: group.getObjectByName('mag') ?? null,
    action: group.getObjectByName('pump') ?? group.getObjectByName('bolt') ?? null,
  };
}
