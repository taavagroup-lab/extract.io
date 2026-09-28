import { RARITY_CONFIG, WEAPONS, getItemDef } from '@extract/game-config';
import type { WeaponId } from '@extract/game-types';
import * as THREE from 'three';
import { glow, mat } from '../materials';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
const hexCyl = new THREE.CylinderGeometry(1, 1, 1, 6);

function part(geo: THREE.BufferGeometry, material: THREE.Material, size: [number, number, number], pos: [number, number, number], alongX = false, tilt = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(...size);
  m.position.set(...pos);
  if (alongX) m.rotation.z = Math.PI / 2;
  if (tilt) m.rotation.z += tilt;
  m.castShadow = true;
  return m;
}

export interface WeaponModel {
  group: THREE.Group;
  /** Muzzle distance along +X from the group origin. */
  muzzle: number;
}

const templates = new Map<WeaponId, WeaponModel>();

/**
 * Procedural firearms, built along +X (grip near the origin). Dark metal and
 * polymer with a thin rarity-coloured accent and an emissive optic lens so
 * the weapon type reads from above.
 */
function build(id: WeaponId): WeaponModel {
  const metal = mat(0x1b1e22, { rough: 0.32, metal: 0.85 });
  const steel = mat(0x3a3f46, { rough: 0.28, metal: 0.9 });
  const polymer = mat(0x2a2f36, { rough: 0.72 });
  const tan = mat(0x7a6a4c, { rough: 0.75 });
  const wood = mat(0x5a3d24, { rough: 0.7 });
  const rarity = getItemDef(WEAPONS[id].itemId).rarity;
  const accent = glow(RARITY_CONFIG[rarity].colorHex, 1, null, 2.2);
  const lens = glow(0xff4d5e, 1, null, 3);
  const g = new THREE.Group();
  let muzzle = 20;
  switch (id) {
    case 'basic_pistol':
      g.add(part(unitBox, polymer, [7, 6.5, 4.6], [0, -2.5, 0], false, 0.25)); // grip
      g.add(part(unitBox, metal, [17, 4.6, 4.8], [7, 2.4, 0])); // slide
      g.add(part(unitBox, steel, [2, 1, 5], [3, 5, 0])); // rear sight
      g.add(part(unitCyl, steel, [1.3, 3, 1.3], [16.5, 2.2, 0], true));
      muzzle = 18;
      break;
    case 'smg':
      g.add(part(unitBox, polymer, [6, 7, 4.6], [0, -2.8, 0], false, 0.2)); // grip
      g.add(part(unitBox, polymer, [22, 7, 5.4], [8, 1.5, 0])); // receiver
      g.add(part(unitBox, metal, [4, 12, 3.6], [11, -5.5, 0], false, -0.1)); // mag
      g.add(part(unitBox, polymer, [10, 4, 3], [-8, 1, 0])); // folded stock
      g.add(part(unitCyl, metal, [2.6, 14, 2.6], [26, 2.2, 0], true)); // suppressor
      g.add(part(unitBox, metal, [8, 3, 3.4], [8, 6.2, 0])); // red dot
      g.add(part(unitBox, lens, [0.4, 1.6, 1.8], [12.2, 6.4, 0]));
      g.add(part(unitBox, accent, [14, 0.8, 5.8], [8, 5.1, 0]));
      muzzle = 33;
      break;
    case 'assault_rifle':
      g.add(part(unitBox, polymer, [6, 7, 4.4], [0, -2.8, 0], false, 0.25)); // grip
      g.add(part(unitBox, metal, [18, 7, 5.2], [7, 1.6, 0])); // receiver
      g.add(part(unitBox, polymer, [14, 5.6, 5.6], [22, 1.8, 0])); // handguard
      g.add(part(unitBox, metal, [4.2, 12, 3.6], [11, -5.6, 0], false, -0.22)); // curved mag
      g.add(part(unitBox, tan, [13, 6, 4.4], [-8, 0.8, 0])); // stock
      g.add(part(unitBox, polymer, [4, 7.4, 4.8], [-15, 0.6, 0])); // butt pad
      g.add(part(unitCyl, metal, [1.5, 12, 1.5], [34, 2, 0], true)); // barrel
      g.add(part(hexCyl, steel, [2.2, 4, 2.2], [41, 2, 0], true)); // muzzle brake
      g.add(part(unitBox, metal, [26, 1.2, 3], [16, 5.2, 0])); // top rail
      g.add(part(unitCyl, metal, [2.4, 9, 2.4], [9, 8.2, 0], true)); // scope tube
      g.add(part(unitCyl, metal, [3.1, 2.4, 3.1], [14, 8.2, 0], true)); // objective
      g.add(part(unitBox, lens, [0.4, 2.2, 2.2], [15.3, 8.2, 0]));
      g.add(part(unitBox, accent, [12, 0.8, 5.8], [22, 4.8, 0]));
      muzzle = 43;
      break;
    case 'shotgun':
      g.add(part(unitBox, polymer, [6, 7, 4.4], [0, -2.8, 0], false, 0.3)); // grip
      g.add(part(unitBox, metal, [14, 7, 5.4], [5, 1.4, 0])); // receiver
      g.add(part(unitBox, wood, [14, 6, 5], [-9, 0.8, 0])); // stock
      g.add(part(unitCyl, metal, [2.2, 30, 2.2], [26, 3, 0], true)); // barrel
      g.add(part(unitCyl, steel, [2.1, 24, 2.1], [23, -0.8, 0], true)); // tube mag
      g.add(part(unitBox, wood, [11, 4.4, 6.4], [21, -0.2, 0])); // pump
      g.add(part(unitBox, steel, [2, 1.6, 2], [39, 5.2, 0])); // bead sight
      g.add(part(unitBox, accent, [8, 0.8, 5.8], [5, 5.2, 0]));
      muzzle = 41;
      break;
  }
  return { group: g, muzzle };
}

/** Returns a new instance (shared geometries/materials) of a weapon model. */
export function weaponModel(id: WeaponId): WeaponModel {
  let t = templates.get(id);
  if (!t) {
    t = build(id);
    templates.set(id, t);
  }
  return { group: t.group.clone(), muzzle: t.muzzle };
}
