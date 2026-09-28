import { weaponFromIndex } from '@extract/game-config';
import { PLAYER_FLAGS, type WeaponId } from '@extract/game-types';
import * as THREE from 'three';
import { glow, mat } from '../materials';
import type { CharacterSkin } from '../skins';
import { COLORS } from '../style';
import { Textures } from '../textures';
import { weaponModel } from './weapons';

const sphere = new THREE.SphereGeometry(1, 20, 14);
const cube = new THREE.BoxGeometry(1, 1, 1);
const capsule = new THREE.CapsuleGeometry(1, 1, 4, 10);
const ring = new THREE.RingGeometry(0.86, 1, 48);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
const gemGeo = new THREE.OctahedronGeometry(1, 0);
const KINGPIN_GOLD = 0xf5c542;
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.BackSide });
/** Visual scale so the model covers the 22-unit hitbox. */
const MODEL_SCALE = 1.2;

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, scale: [number, number, number], pos: [number, number, number], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(...scale);
  m.position.set(...pos);
  m.castShadow = shadow;
  return m;
}

/** A limb between two points in the XZ plane at height y. */
function limb(material: THREE.Material, from: [number, number], to: [number, number], y: number, radius: number): THREE.Group {
  const g = new THREE.Group();
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  // Unit capsule is 3 tall (1 body + 2 caps): scale Y by len/3 for the full limb length.
  const m = mesh(capsule, material, [radius, len / 3, radius], [len / 2, 0, 0]);
  m.rotation.z = Math.PI / 2;
  g.add(m);
  g.position.set(from[0], y, from[1]);
  g.rotation.y = -Math.atan2(dz, dx);
  return g;
}

/**
 * Top-down 3D operator: vest, backpack, helmet with glowing visor, arms,
 * weapon, animated boots. Faces +X locally; the body group rotates to aim.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torsoMat: THREE.MeshStandardMaterial;
  private readonly feet: THREE.Mesh[] = [];
  private readonly gunHolder = new THREE.Group();
  private readonly flash: THREE.Sprite;
  private readonly bountyRing: THREE.Mesh;
  private readonly extractRing: THREE.Mesh;
  private readonly extractBeam: THREE.Mesh;
  private readonly disconnectRing: THREE.Mesh;
  /** KINGPIN: gold ring + floating gem (visible to everyone nearby). */
  private readonly kingpinRing: THREE.Mesh;
  private readonly kingpinGem: THREE.Mesh;
  private weapon: WeaponId | null | undefined = undefined;
  private muzzle = 20;
  private phase = 0;
  private lastX = NaN;
  private lastY = NaN;
  private recoil = 0;
  private flashT = 0;
  private hitT = 0;
  /** Smoothed ground speed (units/s), derived from rendered movement. */
  speed = 0;

  constructor(
    readonly skin: CharacterSkin,
    readonly isSelf: boolean,
  ) {
    const vest = mat(skin.vest, { rough: 0.65 });
    const vestDark = mat(skin.vestDark, { rough: 0.75 });
    const helmet = mat(skin.helmet, { rough: 0.35, metal: 0.4 });
    const gloves = mat(skin.gloves, { rough: 0.8 });
    const skinMat = mat(skin.skinTone, { rough: 0.7 });
    const visor = glow(skin.visor, 1, null, 2.6);
    this.torsoMat = new THREE.MeshStandardMaterial({ color: skin.vest, roughness: 0.6, emissive: 0xff2030, emissiveIntensity: 0 });

    const b = this.body;
    // Inverted-hull outlines keep the silhouette readable on any ground.
    const outline = (scale: [number, number, number], pos: [number, number, number]) => {
      const m = mesh(sphere, OUTLINE, scale, pos, false);
      b.add(m);
    };
    outline([14.6, 14.2, 20.6], [0, 22, 0]);
    outline([13, 10, 13], [0.5, 40, 0]);
    b.add(mesh(sphere, this.torsoMat, [13, 13, 19], [0, 22, 0]));
    b.add(mesh(cube, vestDark, [7, 12, 24], [8, 24, 0]));
    b.add(mesh(cube, vestDark, [12, 16, 20], [-13, 24, 0]));
    b.add(mesh(cube, visor, [7, 1, 3], [-13, 32.6, 0], false));
    b.add(mesh(sphere, skinMat, [9.5, 9.5, 9.5], [2, 36, 0]));
    b.add(mesh(sphere, helmet, [11.5, 8.5, 11.5], [0.5, 40, 0]));
    b.add(mesh(cube, visor, [3, 3.6, 15], [9.5, 38.5, 0], false));
    b.add(limb(vest, [2, 13], [18, 5], 26, 5));
    b.add(limb(vest, [2, -13], [26, -2], 26, 5));
    b.add(mesh(sphere, gloves, [5, 5, 5], [18, 26, 5]));
    b.add(mesh(sphere, gloves, [5, 5, 5], [26, 26, -2]));
    for (const side of [-1, 1]) {
      const foot = mesh(cube, gloves, [11, 5, 7], [0, 3, side * 8]);
      this.feet.push(foot);
      b.add(foot);
    }
    this.gunHolder.position.set(16, 27, 1.5);
    b.add(this.gunHolder);

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: Textures.radial(), color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.flash.scale.set(34, 34, 1);
    this.flash.visible = false;
    this.gunHolder.add(this.flash);

    this.body.scale.setScalar(MODEL_SCALE);
    this.root.add(this.body);

    // Ground rings: self marker, bounty, extraction, disconnected.
    const flat = (color: number, radius: number, opacity: number, y: number): THREE.Mesh => {
      const m = new THREE.Mesh(ring, glow(color, opacity, null, 1.6));
      m.rotation.x = -Math.PI / 2;
      m.scale.set(radius, radius, 1);
      m.position.y = y;
      return m;
    };
    if (isSelf) this.root.add(flat(COLORS.self, 30, 0.55, 1.8));
    this.bountyRing = flat(COLORS.danger, 38, 0.9, 2);
    this.extractRing = flat(COLORS.extraction, 34, 0.9, 2.2);
    this.disconnectRing = flat(0x9ca3af, 32, 0.6, 2.4);
    this.kingpinRing = flat(KINGPIN_GOLD, 46, 0.85, 2.6);
    this.kingpinGem = new THREE.Mesh(gemGeo, glow(KINGPIN_GOLD, 0.95, null, 2.4));
    this.kingpinGem.scale.set(5, 8, 5);
    this.kingpinGem.position.y = 74;
    this.extractBeam = new THREE.Mesh(beamGeo, glow(COLORS.extraction, 0.55, Textures.beam(), 1.4));
    this.extractBeam.scale.set(30, 160, 30);
    this.extractBeam.position.y = 80;
    for (const m of [this.bountyRing, this.extractRing, this.disconnectRing, this.extractBeam, this.kingpinRing, this.kingpinGem]) {
      m.visible = false;
      this.root.add(m);
    }
  }

  setWeapon(weaponIndex: number): void {
    const def = weaponFromIndex(weaponIndex);
    const id = def?.id ?? null;
    if (id === this.weapon) return;
    this.weapon = id;
    this.gunHolder.clear();
    this.gunHolder.add(this.flash);
    if (id) {
      const w = weaponModel(id);
      this.gunHolder.add(w.group);
      this.muzzle = w.muzzle;
    }
    this.flash.position.set(this.muzzle + 8, 1, 0);
  }

  /** Called when this character fires (bullet spawn seen). */
  fire(): void {
    this.recoil = 1;
    this.flashT = 1;
  }

  hit(): void {
    this.hitT = 1;
  }

  update(x: number, y: number, rot: number, flags: number, dt: number, time: number): void {
    this.root.position.set(x, 0, y);
    this.body.rotation.y = -rot;

    // Walk cycle from actual displacement (works for predicted and interpolated movement).
    const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(x - this.lastX, y - this.lastY);
    this.lastX = x;
    this.lastY = y;
    const instant = dt > 0 && moved < 60 ? moved / dt : 0;
    this.speed += (instant - this.speed) * Math.min(1, dt * 12);
    const speed = this.speed;
    if (speed > 20 && moved < 60) this.phase += moved * 0.11;
    const stride = speed > 20 ? 7 : 0;
    const s = Math.sin(this.phase);
    const f0 = this.feet[0]!;
    const f1 = this.feet[1]!;
    f0.position.x += (s * stride - f0.position.x) * Math.min(1, dt * 18);
    f1.position.x += (-s * stride - f1.position.x) * Math.min(1, dt * 18);
    this.body.position.y = speed > 20 ? Math.abs(Math.cos(this.phase)) * 1.8 : 0;
    // Lean slightly into the movement direction.
    const lean = Math.min(1, speed / 260) * 0.08;
    this.body.rotation.z = -lean;

    // Recoil + muzzle flash.
    this.recoil = Math.max(0, this.recoil - dt * 12);
    this.gunHolder.position.x = 16 - this.recoil * 5;
    this.flashT = Math.max(0, this.flashT - dt * 20);
    this.flash.visible = this.flashT > 0;
    this.flash.material.opacity = this.flashT;

    // Hit flash.
    this.hitT = Math.max(0, this.hitT - dt * 6);
    this.torsoMat.emissiveIntensity = this.hitT * 2.2;

    const pulse = 0.5 + 0.5 * Math.sin(time / 180);
    this.bountyRing.visible = (flags & PLAYER_FLAGS.BOUNTY) !== 0;
    if (this.bountyRing.visible) {
      this.bountyRing.rotation.z = time / 700;
      this.bountyRing.scale.setScalar(38 + pulse * 4);
    }
    const extracting = (flags & PLAYER_FLAGS.EXTRACTING) !== 0;
    this.extractRing.visible = extracting;
    this.extractBeam.visible = extracting;
    if (extracting) this.extractRing.scale.setScalar(32 + pulse * 6);
    this.disconnectRing.visible = (flags & PLAYER_FLAGS.DISCONNECTED) !== 0;
    const kingpin = (flags & PLAYER_FLAGS.KINGPIN) !== 0;
    this.kingpinRing.visible = kingpin;
    this.kingpinGem.visible = kingpin;
    if (kingpin) {
      this.kingpinRing.rotation.z = -time / 900;
      this.kingpinRing.scale.setScalar(44 + pulse * 5);
      this.kingpinGem.rotation.y = time / 500;
      this.kingpinGem.position.y = 74 + Math.sin(time / 260) * 3;
    }
  }

  dispose(): void {
    this.torsoMat.dispose();
    this.flash.material.dispose();
    this.root.removeFromParent();
  }
}
