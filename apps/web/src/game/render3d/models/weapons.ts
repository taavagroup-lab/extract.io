import { RARITY_CONFIG, WEAPONS, getItemDef } from '@extract/game-config';
import type { WeaponId } from '@extract/game-types';
import * as THREE from 'three';
import { glow, mat } from '../materials';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);

function part(geo: THREE.BufferGeometry, material: THREE.Material, size: [number, number, number], pos: [number, number, number], alongX = false): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(...size);
  m.position.set(...pos);
  if (alongX) m.rotation.z = Math.PI / 2;
  m.castShadow = true;
  return m;
}

export interface WeaponModel {
  group: THREE.Group;
  /** Muzzle distance along +X from the group origin. */
  muzzle: number;
}

const templates = new Map<WeaponId, WeaponModel>();

function build(id: WeaponId): WeaponModel {
  const metal = mat(0x1d2127, { rough: 0.35, metal: 0.8 });
  const polymer = mat(0x2d333c, { rough: 0.7 });
  const rarity = getItemDef(WEAPONS[id].itemId).rarity;
  const accent = glow(RARITY_CONFIG[rarity].colorHex, 1, null, 2.5);
  const g = new THREE.Group();
  let muzzle = 20;
  switch (id) {
    case 'basic_pistol':
      g.add(part(unitBox, metal, [18, 6, 5], [8, 0, 0]));
      g.add(part(unitBox, polymer, [6, 5, 5.4], [1, -1, 0]));
      muzzle = 18;
      break;
    case 'smg':
      g.add(part(unitBox, polymer, [24, 7, 6], [10, 0, 0]));
      g.add(part(unitBox, metal, [5, 4, 11], [12, -2, 0]));
      g.add(part(unitCyl, metal, [1.8, 10, 1.8], [27, 1, 0], true));
      g.add(part(unitBox, accent, [14, 1, 6.4], [10, 3.8, 0]));
      muzzle = 32;
      break;
    case 'assault_rifle':
      g.add(part(unitBox, polymer, [30, 7, 6], [12, 0, 0]));
      g.add(part(unitBox, polymer, [12, 6, 5], [-8, -0.5, 0]));
      g.add(part(unitCyl, metal, [1.8, 16, 1.8], [35, 1, 0], true));
      g.add(part(unitCyl, metal, [2.4, 11, 2.4], [14, 5.5, 0], true));
      g.add(part(unitBox, metal, [5, 4, 10], [16, -2, 0]));
      g.add(part(unitBox, accent, [22, 1, 6.4], [12, 3.8, 0]));
      muzzle = 43;
      break;
    case 'shotgun':
      g.add(part(unitBox, polymer, [16, 7, 6], [4, 0, 0]));
      g.add(part(unitBox, polymer, [12, 6, 5], [-10, -0.5, 0]));
      g.add(part(unitCyl, metal, [3.2, 30, 3.2], [24, 1.5, 0], true));
      g.add(part(unitBox, mat(0x6b4a2b, { rough: 0.8 }), [10, 5, 7.5], [22, -1.5, 0]));
      g.add(part(unitBox, accent, [10, 1, 6.4], [4, 3.8, 0]));
      muzzle = 39;
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
