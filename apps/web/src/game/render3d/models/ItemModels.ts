import { RARITY_CONFIG, getItemDef, isWeaponId } from '@extract/game-config';
import type { ItemId } from '@extract/game-types';
import * as THREE from 'three';
import { mergeStatic } from '../geometry';
import { glow, mat } from '../materials';
import { Textures } from '../textures';
import { weaponModel } from './weapons';

const cube = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
const ico = new THREE.IcosahedronGeometry(1, 0);
const octa = new THREE.OctahedronGeometry(1, 0);
const sph = new THREE.SphereGeometry(1, 18, 12);
const torus = new THREE.TorusGeometry(1, 0.22, 8, 24);
const cone = new THREE.ConeGeometry(1, 1, 6);
const disc = new THREE.PlaneGeometry(1, 1);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
const ringGeo = new THREE.RingGeometry(0.88, 1, 40);

function p(geo: THREE.BufferGeometry, material: THREE.Material, s: [number, number, number], pos: [number, number, number], rot?: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(...s);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

const AMMO_COLOR: Record<string, number> = { ammo_light: 0xeab308, ammo_rifle: 0x16a34a, ammo_shell: 0xdc2626 };

/** Builds the pickup model for an item (roughly 20-40 units, centered at origin). */
function buildModel(itemId: ItemId): THREE.Group {
  const def = getItemDef(itemId);
  const g = new THREE.Group();
  const gold = mat(0xf2b632, { rough: 0.25, metal: 1 });
  const steel = mat(0xb8c0cc, { rough: 0.3, metal: 0.9 });
  const rarityGlow = glow(RARITY_CONFIG[def.rarity].colorHex, 1, null, 2.4);

  if (def.metadata.weaponId && isWeaponId(def.metadata.weaponId)) {
    // Weapons lie on their side: the side profile (grip, mag, stock, scope)
    // is the most recognisable silhouette from the top-down camera.
    const w = weaponModel(def.metadata.weaponId);
    w.group.position.x = -w.muzzle / 2;
    w.group.rotation.x = -Math.PI / 2;
    g.add(w.group);
    g.scale.setScalar(0.95);
    g.userData.weapon = true;
    return g;
  }
  switch (itemId) {
    case 'ammo_light':
    case 'ammo_rifle':
    case 'ammo_shell': {
      g.add(p(cube, mat(0x3a4232, { rough: 0.8 }), [20, 9, 13], [0, 0, 0]));
      g.add(p(cube, mat(AMMO_COLOR[itemId]!, { rough: 0.6 }), [20.4, 3, 13.4], [0, 1, 0]));
      const brass = mat(0xd4a017, { rough: 0.3, metal: 0.9 });
      for (const dx of [-6, 0, 6]) g.add(p(cyl, brass, [2.2, 8, 2.2], [dx, 8, 0]));
      break;
    }
    case 'medkit': {
      const box = new THREE.Mesh(cube, [mat(0xf1f5f9), mat(0xf1f5f9), mat(0xffffff, { map: Textures.medCross() }), mat(0xe2e8f0), mat(0xf1f5f9), mat(0xf1f5f9)]);
      box.scale.set(20, 10, 16);
      box.castShadow = true;
      g.add(box);
      break;
    }
    case 'armor_plate':
      g.add(p(cube, mat(0x475569, { rough: 0.4, metal: 0.7 }), [22, 4, 26], [0, 0, 0]));
      g.add(p(cube, glow(0x38bdf8, 1, null, 2.5), [23, 1, 2], [0, 2.4, -10]));
      g.add(p(cube, glow(0x38bdf8, 1, null, 2.5), [23, 1, 2], [0, 2.4, 10]));
      break;
    case 'scrap':
      g.add(p(ico, steel, [6, 5, 6], [-5, 0, 0], [0.3, 0.5, 0]));
      g.add(p(ico, mat(0x8b5a2b, { rough: 0.9, metal: 0.4 }), [5, 4, 5], [5, 0, 3], [0.7, 0.1, 0.4]));
      g.add(p(ico, steel, [4, 3, 4], [2, 3, -5], [0.1, 0.9, 0.3]));
      break;
    case 'copper_wire': {
      const copper = mat(0xc56b33, { rough: 0.35, metal: 0.95 });
      g.add(p(torus, copper, [9, 9, 9], [0, 0, 0], [Math.PI / 2, 0, 0]));
      g.add(p(torus, copper, [7, 7, 7], [0, 3, 0], [Math.PI / 2, 0, 0]));
      break;
    }
    case 'circuit_board':
      g.add(p(cube, mat(0x166534, { rough: 0.6 }), [22, 2, 15], [0, 0, 0]));
      g.add(p(cube, mat(0x111827, { rough: 0.5 }), [7, 2, 7], [-4, 2, 0]));
      g.add(p(cube, gold, [3, 1.5, 3], [5, 2, 4]));
      g.add(p(cube, gold, [3, 1.5, 3], [5, 2, -4]));
      g.add(p(cube, glow(0x22d3ee, 1, null, 2), [1, 0.5, 12], [9, 1.3, 0]));
      break;
    case 'gold_bar':
      g.add(p(cube, gold, [22, 7, 11], [0, 0, 0]));
      g.add(p(cube, gold, [18, 3, 8], [0, 5, 0]));
      break;
    case 'quantum_core':
      g.add(p(sph, glow(0x67e8f9, 1, null, 3.5), [7, 7, 7], [0, 0, 0]));
      g.add(p(torus, steel, [12, 12, 12], [0, 0, 0], [Math.PI / 2, 0, 0]));
      g.add(p(torus, rarityGlow, [15, 15, 15], [0, 0, 0], [Math.PI / 2.6, 0.4, 0]));
      break;
    case 'rare_skin_fragment':
      g.add(p(octa, glow(0x60a5fa, 0.9, null, 2.5), [7, 12, 7], [0, 0, 0]));
      g.add(p(octa, glow(0x93c5fd, 0.8, null, 2.5), [4, 7, 4], [8, -2, 3], [0.4, 0, 0.5]));
      break;
    case 'epic_weapon_skin':
      g.add(p(cube, mat(0x1e1b4b, { rough: 0.2, metal: 0.8 }), [18, 1.5, 26], [0, 0, 0]));
      g.add(p(cube, glow(0xc084fc, 1, null, 2.8), [15, 0.5, 22], [0, 1.1, 0]));
      break;
    case 'cyber_katana':
      g.add(p(cube, steel, [44, 1.6, 4], [6, 0, 0]));
      g.add(p(cube, glow(0x22d3ee, 1, null, 3), [44, 0.6, 1], [6, 1, 2]));
      g.add(p(cube, mat(0x111111, { rough: 0.6 }), [12, 3.5, 3.5], [-22, 0, 0]));
      g.add(p(cube, gold, [2, 5, 9], [-16, 0, 0]));
      break;
    case 'genesis_crown': {
      g.add(p(cyl, gold, [11, 7, 11], [0, 0, 0]));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(p(cone, gold, [3, 9, 3], [Math.cos(a) * 9.5, 8, Math.sin(a) * 9.5]));
        g.add(p(sph, glow(0xef4444, 1, null, 3.2), [1.8, 1.8, 1.8], [Math.cos(a + 0.6) * 11.2, 1, Math.sin(a + 0.6) * 11.2]));
      }
      break;
    }
    default:
      g.add(p(cube, rarityGlow, [12, 12, 12], [0, 0, 0]));
  }
  mergeStatic(g);
  return g;
}

const templates = new Map<ItemId, THREE.Group>();

/**
 * Ground item: floating, rotating model + rarity glow on the ground and, for
 * EPIC and above, a light beam visible from afar.
 */
export class GroundItemModel {
  readonly root = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly glowDisc: THREE.Mesh;
  private readonly beam: THREE.Mesh | null = null;
  private readonly halo: THREE.Mesh | null = null;
  private readonly phase = Math.random() * Math.PI * 2;
  private readonly weapon: boolean;
  private readonly yaw = Math.random() * Math.PI * 2;
  /** Drop pop animation progress (1 = settled). */
  private spawnT: number;
  private spawnAt = -1;
  private readonly baseScale: number;
  private collectT = 0;
  readonly rank: number;
  readonly color: number;

  /** `animate`: the item was just dropped / spilled and pops out of the ground. */
  constructor(itemId: ItemId, x: number, y: number, animate = false) {
    let t = templates.get(itemId);
    if (!t) {
      t = buildModel(itemId);
      templates.set(itemId, t);
    }
    this.model = t.clone();
    this.weapon = t.userData.weapon === true;
    this.baseScale = this.model.scale.x;
    this.spawnT = animate ? 0 : 1;
    const def = getItemDef(itemId);
    const color = RARITY_CONFIG[def.rarity].colorHex;
    this.color = color;
    this.rank = RARITY_CONFIG[def.rarity].rank;

    this.glowDisc = new THREE.Mesh(disc, glow(color, 0.3 + this.rank * 0.07, Textures.radial(), 0.8 + this.rank * 0.18));
    this.glowDisc.rotation.x = -Math.PI / 2;
    this.glowDisc.scale.setScalar(46 + this.rank * 10);
    this.glowDisc.position.y = 2.6;
    this.root.add(this.glowDisc, this.model);

    if (this.rank >= 2) {
      this.beam = new THREE.Mesh(beamGeo, glow(color, 0.22 + (this.rank - 2) * 0.08, Textures.beam(), 1.2 + this.rank * 0.2));
      const h = 70 + this.rank * 30;
      this.beam.scale.set(4 + this.rank, h, 4 + this.rank);
      this.beam.position.y = h / 2;
      this.root.add(this.beam);
    }
    if (this.rank >= 3) {
      // Legendary+: a slowly turning halo so the find reads as special from afar.
      this.halo = new THREE.Mesh(ringGeo, glow(color, 0.7, null, 2.4));
      this.halo.rotation.x = -Math.PI / 2;
      this.halo.scale.setScalar(26);
      this.halo.position.y = 3;
      this.root.add(this.halo);
    }
    this.root.position.set(x, 0, y);
  }

  update(time: number): void {
    const t = time / 1000 + this.phase;
    // Pop: arc up out of the spill point, land with a small bounce.
    let lift = 0;
    let scale = 1;
    if (this.spawnT < 1) {
      if (this.spawnAt < 0) this.spawnAt = time;
      this.spawnT = Math.min(1, (time - this.spawnAt) / 480);
      const k = this.spawnT;
      lift = Math.sin(Math.min(1, k / 0.7) * Math.PI) * 26 + (k > 0.7 ? Math.sin(((k - 0.7) / 0.3) * Math.PI) * 4 : 0);
      scale = 0.35 + 0.65 * Math.min(1, k * 1.8);
    }
    if (this.weapon) {
      // Lying weapon: gentle hover and a slow sway instead of a spin.
      this.model.position.y = 7 + Math.sin(t * 1.8) * 1.5 + lift;
      this.model.rotation.y = this.yaw + Math.sin(t * 0.6) * 0.3;
    } else {
      this.model.position.y = 14 + Math.sin(t * 2.2) * 3 + lift;
      this.model.rotation.y = t * 0.9;
    }
    this.model.scale.setScalar(this.baseScale * scale);
    const pulse = 0.85 + 0.15 * Math.sin(t * 3);
    this.glowDisc.scale.setScalar((46 + this.rank * 10) * pulse * (0.4 + 0.6 * this.spawnT));
    if (this.halo) {
      this.halo.rotation.z = t * 0.8;
      this.halo.scale.setScalar(24 + Math.sin(t * 2.4) * 3);
    }
  }

  /**
   * Picked up: the item zips into the collector and shrinks away.
   * Returns false once the animation is over (caller disposes).
   */
  collect(dt: number, x: number, z: number): boolean {
    this.collectT += dt / 0.2;
    const k = Math.min(1, this.collectT);
    const e = k * k;
    this.root.position.x += (x - this.root.position.x) * e;
    this.root.position.z += (z - this.root.position.z) * e;
    this.model.position.y += (30 - this.model.position.y) * e;
    this.model.scale.setScalar(this.baseScale * (1 - k * 0.85));
    this.glowDisc.visible = false;
    if (this.beam) this.beam.visible = false;
    if (this.halo) this.halo.visible = false;
    return k < 1;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
