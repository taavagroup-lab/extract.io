import { weaponFromIndex } from '@extract/game-config';
import { PLAYER_FLAGS, type WeaponCategory, type WeaponDefinition } from '@extract/game-types';
import * as THREE from 'three';
import { mergeStatic } from '../geometry';
import { decalMat, glow, mat } from '../materials';
import type { CharacterSkin } from '../skins';
import { COLORS } from '../style';
import { Decals, Textures } from '../textures';
import { MuzzleFlash } from './MuzzleFlash';
import { weaponModel, type WeaponModel } from './weapons';

const sphere = new THREE.SphereGeometry(1, 18, 12);
const lowSphere = new THREE.SphereGeometry(1, 12, 8);
const cube = new THREE.BoxGeometry(1, 1, 1);
const capsule = new THREE.CapsuleGeometry(1, 1, 4, 10);
const earCup = new THREE.CylinderGeometry(1, 1, 1, 10);
const antennaGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 5);
const ring = new THREE.RingGeometry(0.86, 1, 48);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
const gemGeo = new THREE.OctahedronGeometry(1, 0);
const helmetGeo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
const flatQuad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.BackSide });
const KINGPIN_GOLD = 0xf5c542;
/** Visual scale so the model covers the 22-unit hitbox. */
export const MODEL_SCALE = 1.18;
/** Fraction of the swap animation at which the model changes hands. */
const SWAP_AT = 0.4;

/**
 * Where the weapon's grip sits in body space per weapon type. Pistols are
 * held out two-handed on the centre line; long guns are shouldered and
 * carried slightly to the right (-Z).
 */
const HOLD: Record<WeaponCategory, { x: number; y: number; z: number }> = {
  PISTOL: { x: 21, y: 28.5, z: 0 },
  SMG: { x: 13, y: 27.5, z: -2 },
  RIFLE: { x: 13, y: 27.5, z: -2 },
  SHOTGUN: { x: 13, y: 27.5, z: -2 },
  MARKSMAN: { x: 15, y: 27.8, z: -2 },
  LMG: { x: 13, y: 27, z: -2.5 },
};

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, scale: [number, number, number], pos: [number, number, number], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(...scale);
  m.position.set(...pos);
  m.castShadow = shadow;
  return m;
}

/** Capsule between two points (any direction). */
function bone(material: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Mesh {
  const dir = to.clone().sub(from);
  const len = dir.length();
  // Unit capsule is 3 tall (1 body + 2 caps): scale Y by len/3 for the full length.
  const m = new THREE.Mesh(capsule, material);
  m.scale.set(radius, Math.max(0.01, len / 3), radius);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** 0 -> 1 -> 0 bump over [a, b]. */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));

/**
 * Top-down 3D operator: plate carrier with pouches, backpack with antenna,
 * helmet with rails / NVG mount and glowing goggles, shoulder pads, legs with
 * knee pads and boots. The weapon hangs in a small rig
 * (hold point -> sway -> kick -> model) so it can sway, kick back, lower for
 * swaps and tilt for reloads, with the arms rebuilt to reach its grips.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly torsoMat: THREE.MeshStandardMaterial;
  private readonly legs: THREE.Group[] = [];
  private readonly arms = new THREE.Group();
  private readonly armMats: { shirt: THREE.Material; gloves: THREE.Material };
  /** Weapon rig. */
  private readonly holdPivot = new THREE.Group();
  private readonly kickGroup = new THREE.Group();
  private readonly muzzleAnchor = new THREE.Group();
  private readonly ejectAnchor = new THREE.Group();
  private readonly flash = new MuzzleFlash();
  private readonly groundGlow: THREE.Mesh;
  private gun: WeaponModel | null = null;
  private def: WeaponDefinition | null = null;
  private magRest = new THREE.Vector3();
  private actionRest = new THREE.Vector3();

  private readonly bountyRing: THREE.Mesh;
  private readonly extractRing: THREE.Mesh;
  private readonly extractBeam: THREE.Mesh;
  private readonly disconnectRing: THREE.Mesh;
  /** KINGPIN: gold ring + floating gem (visible to everyone nearby). */
  private readonly kingpinRing: THREE.Mesh;
  private readonly kingpinGem: THREE.Mesh;
  private readonly markers: THREE.Mesh[];

  private weaponIdx: number | undefined = undefined;
  private phase = Math.random() * 10;
  private lastX = NaN;
  private lastY = NaN;
  private lastRot = NaN;
  private aimLag = 0;
  private kick = 0;
  private kickTilt = 0;
  private vibration = 0;
  private actionT = -1;
  private hitT = 0;
  private reloadBlend = 0;
  private reloadStartedAt = -1;
  private shellBump = 0;
  /** Swap animation: 0..1 (the model changes at SWAP_AT), -1 = idle. */
  private swapT = -1;
  private swapMs = 300;
  private pendingIdx = -1;
  private deathT = -1;
  private deathSide = 1;
  private groundGlowT = 0;
  /** Deploy animation (drop in + settle), 1 = done. */
  private spawnT = 1;
  /** Smoothed ground speed (units/s), derived from rendered movement. */
  speed = 0;

  constructor(
    readonly skin: CharacterSkin,
    readonly isSelf: boolean,
  ) {
    const fabric = Textures.burlap();
    const vest = mat(skin.vest, { rough: 0.8, map: fabric.map, normalMap: fabric.normalMap, normal: 0.6 });
    const gear = mat(skin.vestDark, { rough: 0.8 });
    const shirt = mat(skin.shirt, { rough: 0.85 });
    const pants = mat(skin.pants, { rough: 0.85 });
    const helmet = mat(skin.helmet, { rough: 0.5, metal: 0.25 });
    const gloves = mat(skin.gloves, { rough: 0.8 });
    const boots = mat(skin.boots, { rough: 0.7 });
    const skinMat = mat(skin.skinTone, { rough: 0.7 });
    const metal = mat(0x1d2024, { rough: 0.4, metal: 0.8 });
    const visor = glow(skin.visor, 1, null, 2.6);
    this.torsoMat = new THREE.MeshStandardMaterial({ color: skin.shirt, roughness: 0.8, emissive: 0xff2030, emissiveIntensity: 0 });
    this.armMats = { shirt, gloves };

    const b = this.body;
    const u = this.upper;
    b.add(u);

    // Legs (pivot at the hip, swing around Z).
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 16, side * 5.5);
      pivot.add(
        bone(pants, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.5, -7, 0), 3.8),
        bone(pants, new THREE.Vector3(1.5, -7, 0), new THREE.Vector3(0, -13, 0), 3.4),
        mesh(cube, gear, [3, 3.6, 4.6], [3.8, -7, 0]),
        mesh(cube, boots, [9, 4.4, 5.6], [1.6, -14, 0]),
      );
      mergeStatic(pivot, undefined, `leg:${skin.id}`);
      b.add(pivot);
      this.legs.push(pivot);
    }
    // Hips + belt.
    u.add(mesh(sphere, pants, [8, 5, 10], [0, 17, 0]));
    u.add(mesh(cube, gear, [11, 2.4, 19], [0, 19.5, 0]));

    // Torso with outline, plate carrier, pouches.
    u.add(mesh(sphere, OUTLINE, [12.8, 12.6, 16.6], [0, 26, 0], false));
    u.add(mesh(sphere, this.torsoMat, [11, 11, 14.5], [0, 26, 0]));
    u.add(mesh(cube, vest, [15, 15, 20], [0.8, 27, 0]));
    for (const z of [-5.2, 0, 5.2]) u.add(mesh(cube, gear, [3, 5, 5], [8.6, 24, z]));
    u.add(mesh(cube, gear, [2.4, 3, 7], [8.4, 30, 5]));
    // Backpack + antenna.
    u.add(mesh(cube, gear, [8, 15, 16], [-11, 27, 0]));
    u.add(mesh(cube, vest, [3, 11, 12], [-15.2, 26, 0]));
    u.add(mesh(antennaGeo, metal, [1, 20, 1], [-13, 42, -5]));
    // Shoulder pads.
    for (const side of [-1, 1]) u.add(mesh(lowSphere, vest, [6.2, 5, 6.4], [0.5, 33, side * 10.4]));

    // Head: neck gaiter, face, helmet with rails and ear pro, NVG mount, goggles.
    u.add(mesh(sphere, OUTLINE, [10.6, 9.2, 10.6], [1, 40, 0], false));
    u.add(mesh(sphere, gear, [6.4, 4, 6.4], [1, 34.5, 0]));
    u.add(mesh(sphere, skinMat, [7.8, 8.2, 7.8], [2, 38, 0]));
    u.add(mesh(helmetGeo, helmet, [9.8, 9.2, 9.8], [0.6, 38.8, 0]));
    for (const side of [-1, 1]) {
      u.add(mesh(cube, metal, [8, 1.8, 1.2], [0.8, 41, side * 9]));
      u.add(mesh(earCup, gear, [2.8, 2.4, 2.8], [1, 37.5, side * 8.2]));
    }
    u.add(mesh(cube, metal, [3.2, 3.2, 5], [8.6, 43, 0]));
    u.add(mesh(cube, OUTLINE, [4, 3.4, 13], [8.4, 38, 0], false));
    u.add(mesh(cube, visor, [2.2, 2.6, 12], [9.2, 38.2, 0], false));

    // Static body parts: one draw call per material, shared by every operator in this skin.
    mergeStatic(u, (m) => m.material === this.torsoMat, `upper:${skin.id}`);

    // Weapon rig.
    u.add(this.arms);
    this.kickGroup.add(this.muzzleAnchor, this.ejectAnchor);
    this.holdPivot.add(this.kickGroup);
    u.add(this.holdPivot);
    this.muzzleAnchor.add(this.flash.group);

    this.body.scale.setScalar(MODEL_SCALE);
    this.root.add(this.body);

    // Warm light pool thrown on the ground by the muzzle flash.
    this.groundGlow = new THREE.Mesh(flatQuad, decalMat('additive', Decals.lightPool(), 0xffb064, 0.5).clone());
    this.groundGlow.scale.set(120, 1, 120);
    this.groundGlow.position.y = 2.5;
    this.groundGlow.renderOrder = 3;
    this.groundGlow.visible = false;
    this.root.add(this.groundGlow);

    // Soft contact shadow under the feet.
    const contact = new THREE.Mesh(flatQuad, decalMat('shade', Decals.softShadow(), 0x000000, 0.55));
    contact.scale.set(48, 1, 48);
    contact.position.y = 2.2;
    contact.renderOrder = 1;
    this.root.add(contact);

    // Ground rings: self marker, bounty, extraction, disconnected, kingpin.
    const flat = (color: number, radius: number, opacity: number, y: number): THREE.Mesh => {
      const m = new THREE.Mesh(ring, glow(color, opacity, null, 1.6));
      m.rotation.x = -Math.PI / 2;
      m.scale.set(radius, radius, 1);
      m.position.y = y;
      return m;
    };
    if (isSelf) this.root.add(flat(COLORS.self, 30, 0.55, 2.6));
    this.bountyRing = flat(COLORS.danger, 38, 0.9, 2.8);
    this.extractRing = flat(COLORS.extraction, 34, 0.9, 3);
    this.disconnectRing = flat(0x9ca3af, 32, 0.6, 3.2);
    this.kingpinRing = flat(KINGPIN_GOLD, 46, 0.85, 3.4);
    this.kingpinGem = new THREE.Mesh(gemGeo, glow(KINGPIN_GOLD, 0.95, null, 2.4));
    this.kingpinGem.scale.set(5, 8, 5);
    this.kingpinGem.position.y = 76;
    this.extractBeam = new THREE.Mesh(beamGeo, glow(COLORS.extraction, 0.55, Textures.beam(), 1.4));
    this.extractBeam.scale.set(30, 160, 30);
    this.extractBeam.position.y = 80;
    this.markers = [this.bountyRing, this.extractRing, this.disconnectRing, this.extractBeam, this.kingpinRing, this.kingpinGem];
    for (const m of this.markers) {
      m.visible = false;
      this.root.add(m);
    }
    this.mountWeapon(-1);
  }

  get weapon(): WeaponDefinition | null {
    return this.def;
  }

  /** Swaps weapons: lowers the current one, changes the model, raises the new one. */
  setWeapon(index: number, animate = true): void {
    if (this.weaponIdx === undefined || !animate || this.deathT >= 0) {
      if (index !== this.weaponIdx) this.mountWeapon(index);
      return;
    }
    const target = this.swapT >= 0 ? this.pendingIdx : this.weaponIdx;
    if (index === target) return;
    this.pendingIdx = index;
    const def = weaponFromIndex(index);
    this.swapMs = Math.max(220, def?.equipMs ?? 250);
    if (this.swapT < 0 || this.swapT >= SWAP_AT) this.swapT = 0;
  }

  private mountWeapon(index: number): void {
    this.weaponIdx = index;
    const def = weaponFromIndex(index);
    this.def = def;
    if (this.gun) this.gun.group.removeFromParent();
    this.gun = def ? weaponModel(def.id) : null;
    const hold = HOLD[def?.category ?? 'RIFLE'];
    this.holdPivot.position.set(hold.x + (def?.visual.holdOffset ?? 0), hold.y, hold.z);
    if (this.gun) {
      this.kickGroup.add(this.gun.group);
      this.muzzleAnchor.position.set(this.gun.muzzle, this.gun.bore, 0);
      this.ejectAnchor.position.set(this.gun.eject, this.gun.bore + 1, -3);
      if (this.gun.mag) this.magRest.copy(this.gun.mag.position);
      if (this.gun.action) this.actionRest.copy(this.gun.action.position);
    }
    this.buildArms(def, hold);
    this.actionT = -1;
  }

  /** Arms from the shoulders to the weapon's grips (rebuilt per weapon). */
  private buildArms(def: WeaponDefinition | null, hold: { x: number; y: number; z: number }): void {
    this.arms.clear();
    const { shirt, gloves } = this.armMats;
    const px = hold.x + (def?.visual.holdOffset ?? 0);
    const pistol = def?.category === 'PISTOL';
    const rShoulder = new THREE.Vector3(1, 31, -10);
    const lShoulder = new THREE.Vector3(1, 31, 10);
    const rHand = new THREE.Vector3(px + 0.5, hold.y - 1.5, hold.z - 1);
    const support = this.gun?.support ?? 12;
    const lHand = pistol ? new THREE.Vector3(px - 0.5, hold.y - 2.2, hold.z + 2.4) : new THREE.Vector3(px + support, hold.y - 0.6, hold.z + 2.2);
    const rElbow = new THREE.Vector3((rShoulder.x + rHand.x) / 2 - 1, 24.5, -12);
    const lElbow = pistol ? new THREE.Vector3((lShoulder.x + lHand.x) / 2 - 1, 24.5, 11) : new THREE.Vector3((lShoulder.x + lHand.x) / 2, 25.5, 8);
    this.arms.add(bone(shirt, rShoulder, rElbow, 3.4), bone(shirt, rElbow, rHand, 3));
    this.arms.add(bone(shirt, lShoulder, lElbow, 3.4), bone(shirt, lElbow, lHand, 3));
    this.arms.add(mesh(sphere, gloves, [3.4, 3.4, 3.4], [rHand.x, rHand.y, rHand.z]));
    this.arms.add(mesh(sphere, gloves, [3.4, 3.4, 3.4], [lHand.x, lHand.y, lHand.z]));
    mergeStatic(this.arms, undefined, `arms:${this.skin.id}:${def?.id ?? 'none'}`);
  }

  /** Called when this character fires a round. */
  fire(): void {
    const def = this.def;
    if (!def) return;
    const v = def.visual;
    // Kick stacks a little under automatic fire but stays bounded.
    this.kick = Math.min(this.kick + v.kick, v.kick * 1.7);
    this.kickTilt = Math.min(this.kickTilt + v.kickTilt, v.kickTilt * 1.8);
    this.vibration = Math.min(1, this.vibration + v.vibration * 0.35);
    this.flash.fire(v.muzzleFlash);
    this.groundGlowT = 1;
    const glowMat = this.groundGlow.material as THREE.MeshBasicMaterial;
    glowMat.color.setHex(v.muzzleFlash === 'void' ? 0xa35cff : 0xffb064);
    const size = v.muzzleFlash === 'suppressed' ? 50 : v.muzzleFlash === 'shotgun' || v.muzzleFlash === 'sniper' ? 190 : 130;
    this.groundGlow.scale.set(size, 1, size);
    if (this.gun?.action) this.actionT = 0;
  }

  /** Deploy: the operator drops in and settles (match start). */
  spawnIn(): void {
    this.spawnT = 0;
  }

  /** A shotgun shell went in (small bounce of the gun). */
  shellIn(): void {
    this.shellBump = 1;
  }

  hit(): void {
    this.hitT = 1;
  }

  /** World position of the muzzle (after `update`). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.muzzleAnchor.getWorldPosition(out);
  }

  /** World position of the ejection port (after `update`). */
  ejectWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.ejectAnchor.getWorldPosition(out);
  }

  /** Starts the death fall; `side` picks which way the body topples. */
  die(side: number): void {
    if (this.deathT >= 0) return;
    this.deathT = 0;
    this.deathSide = side >= 0 ? 1 : -1;
    for (const m of this.markers) m.visible = false;
    this.flash.group.visible = false;
    this.groundGlow.visible = false;
  }

  get dead(): boolean {
    return this.deathT >= 0;
  }

  /** Advances the death animation; returns false once the body should be removed. */
  updateDeath(dt: number): boolean {
    this.deathT += dt;
    const fall = Math.min(1, this.deathT / 0.42);
    const e = 1 - Math.pow(1 - fall, 3);
    // Topple sideways, knees buckle, the gun slips out of the hands.
    this.body.rotation.x = this.deathSide * e * 1.45;
    this.body.position.y = -e * 4;
    this.upper.rotation.z = -e * 0.3;
    this.holdPivot.rotation.set(0, e * 0.6, -e * 0.9);
    this.holdPivot.position.y -= dt * 6 * (1 - fall);
    for (const l of this.legs) l.rotation.z = e * 0.5;
    const fade = this.deathT > 4 ? Math.max(0, 1 - (this.deathT - 4) / 1.2) : 1;
    this.root.position.y = -(1 - fade) * 20;
    return fade > 0;
  }

  /**
   * Per frame. `reloadProgress` (0..1) drives the reload animation for the
   * local player; remote players estimate it from the RELOADING flag.
   */
  update(x: number, y: number, rot: number, flags: number, dt: number, time: number, reloadProgress: number | null = null): void {
    let drop = 0;
    if (this.spawnT < 1) {
      this.spawnT = Math.min(1, this.spawnT + dt / 0.45);
      const e = 1 - Math.pow(1 - this.spawnT, 3);
      drop = (1 - e) * 34;
      this.body.scale.setScalar(MODEL_SCALE * (0.75 + 0.25 * e));
    }
    this.root.position.set(x, drop, y);
    this.body.rotation.y = -rot;

    // Walk cycle from actual displacement (works for predicted and interpolated movement).
    const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(x - this.lastX, y - this.lastY);
    const heading = moved > 0.01 ? Math.atan2(y - this.lastY, x - this.lastX) : rot;
    this.lastX = x;
    this.lastY = y;
    const instant = dt > 0 && moved < 60 ? moved / dt : 0;
    this.speed += (instant - this.speed) * Math.min(1, dt * 12);
    const speed = this.speed;
    const walking = speed > 20 && moved < 60;
    if (walking) this.phase += moved * 0.1;
    // Legs swing along the travel direction relative to where the body faces.
    const rel = walking ? heading - rot : 0;
    const fwd = Math.cos(rel);
    const amp = walking ? Math.min(1, speed / 240) * 0.75 : 0;
    const s = Math.sin(this.phase);
    this.legs.forEach((l, i) => {
      const sw = i === 0 ? s : -s;
      l.rotation.z += (sw * amp * Math.sign(fwd || 1) * Math.abs(fwd) - l.rotation.z) * Math.min(1, dt * 16);
      l.rotation.x += (Math.sin(rel) * amp * 0.5 * sw - l.rotation.x) * Math.min(1, dt * 16);
    });
    const bob = walking ? Math.abs(Math.cos(this.phase)) * 1.6 : Math.sin(time / 650) * 0.35;
    this.upper.position.y = bob;
    this.body.rotation.z = -Math.min(1, speed / 260) * 0.08 * fwd;

    this.updateWeapon(dt, time, flags, walking ? amp : 0, rot, reloadProgress);

    // Hit flinch + flash.
    this.hitT = Math.max(0, this.hitT - dt * 6);
    this.torsoMat.emissiveIntensity = this.hitT * 2.4;
    this.upper.rotation.x = Math.sin(time / 30) * this.hitT * 0.08;

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
      this.kingpinGem.position.y = 76 + Math.sin(time / 260) * 3;
    }
  }

  private updateWeapon(dt: number, time: number, flags: number, walk: number, rot: number, reloadProgress: number | null): void {
    const def = this.def;
    const v = def?.visual;

    // Swap: lower, change model at SWAP_AT, raise.
    let lowered = 0;
    if (this.swapT >= 0) {
      const before = this.swapT;
      this.swapT += (dt * 1000) / this.swapMs;
      if (before < SWAP_AT && this.swapT >= SWAP_AT) this.mountWeapon(this.pendingIdx);
      if (this.swapT >= 1) this.swapT = -1;
      else lowered = this.swapT < SWAP_AT ? ease(this.swapT / SWAP_AT) : 1 - ease((this.swapT - SWAP_AT) / (1 - SWAP_AT));
    }

    // Reload progress: exact for the local player, estimated for others.
    const reloading = (flags & PLAYER_FLAGS.RELOADING) !== 0 || reloadProgress !== null;
    if (reloading && this.reloadStartedAt < 0) this.reloadStartedAt = time;
    if (!reloading) this.reloadStartedAt = -1;
    const progress = reloadProgress ?? (reloading && def ? clamp01((time - this.reloadStartedAt) / def.reloadMs) : 0);
    this.reloadBlend += ((reloading ? 1 : 0) - this.reloadBlend) * Math.min(1, dt * 12);
    const shell = def?.reloadStyle === 'SHELL';

    // Aim lag: the gun trails fast turns a little.
    if (!Number.isNaN(this.lastRot) && dt > 0) {
      let d = rot - this.lastRot;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const target = Math.max(-0.16, Math.min(0.16, (d / dt) * 0.012));
      this.aimLag += (target - this.aimLag) * Math.min(1, dt * 14);
    }
    this.lastRot = rot;

    // Recoil springs back.
    const rec = v?.kickRecovery ?? 14;
    this.kick *= Math.exp(-dt * rec);
    this.kickTilt *= Math.exp(-dt * rec * 0.8);
    this.vibration *= Math.exp(-dt * 7);
    this.shellBump = Math.max(0, this.shellBump - dt * 7);

    const breathe = Math.sin(time / 900) * 0.012;
    const sway = Math.sin(this.phase) * 0.035 * walk;
    const r = this.reloadBlend;
    // Reload pose: tilt the gun (roll + pitch down) to work the mag / loading port.
    const roll = r * (shell ? 0.55 : 0.75);
    const pitch = r * (shell ? 0.18 : 0.28);
    const jitter = this.vibration * 0.5;

    const hp = this.holdPivot;
    hp.rotation.x = roll + lowered * 0.5 + (Math.random() - 0.5) * jitter * 0.04;
    hp.rotation.y = this.aimLag + breathe + sway + lowered * 0.5;
    hp.rotation.z = -pitch - lowered * 0.85 + Math.sin(time / 1300) * 0.01;

    // Charging handle / bolt jerk near the end of a magazine reload, bounce per shell.
    const charge = !shell && reloading ? bump(progress, 0.74, 0.9) : 0;
    this.kickGroup.position.set(-this.kick - charge * 3 - lowered * 5, this.shellBump * 0.8 + (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter);
    this.kickGroup.rotation.z = this.kickTilt + this.shellBump * 0.05;
    // Hands ride the recoil.
    this.arms.position.x = -this.kick * 0.55 - lowered * 3;

    // Magazine out (0.15-0.4) and back in (0.45-0.7).
    const mag = this.gun?.mag;
    if (mag) {
      let drop = 0;
      if (reloading && !shell) {
        if (progress < 0.45) drop = ease(clamp01((progress - 0.12) / 0.26));
        else drop = 1 - ease(clamp01((progress - 0.45) / 0.25));
      }
      mag.position.set(this.magRest.x - drop * 1.5, this.magRest.y - drop * 11, this.magRest.z);
      mag.visible = drop < 0.97;
    }

    // Pump / bolt cycles shortly after each shot.
    const act = this.gun?.action;
    if (act && def) {
      if (this.actionT >= 0) {
        this.actionT += dt;
        const t = clamp01((this.actionT - 0.22) / 0.3);
        const back = Math.sin(t * Math.PI);
        if (act.name === 'bolt') act.position.set(this.actionRest.x - back * 5, this.actionRest.y, this.actionRest.z - back * 1.2);
        else act.position.set(this.actionRest.x - back * 7, this.actionRest.y, this.actionRest.z);
        if (t >= 1) this.actionT = -1;
      } else if (shell && reloading) {
        // Racks the pump once at the end of a shell reload.
        const back = bump(progress, 0.9, 1);
        act.position.set(this.actionRest.x - back * 7, this.actionRest.y, this.actionRest.z);
      } else act.position.copy(this.actionRest);
    }

    this.flash.update(dt);
    this.groundGlowT = Math.max(0, this.groundGlowT - dt * 18);
    this.groundGlow.visible = this.groundGlowT > 0;
    if (this.groundGlow.visible) {
      const m = this.groundGlow.material as THREE.MeshBasicMaterial;
      m.opacity = this.groundGlowT * 0.55;
      const d = (v?.muzzleDistance ?? 50) * 0.8;
      this.groundGlow.position.set(Math.cos(rot) * d, 2.5, Math.sin(rot) * d);
    }
  }

  dispose(): void {
    this.torsoMat.dispose();
    this.flash.dispose();
    (this.groundGlow.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}
