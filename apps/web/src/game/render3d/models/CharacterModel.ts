import { weaponFromIndex } from '@extract/game-config';
import { PLAYER_FLAGS, type WeaponId } from '@extract/game-types';
import * as THREE from 'three';
import { decalMat, glow, mat } from '../materials';
import type { CharacterSkin } from '../skins';
import { COLORS } from '../style';
import { Decals, Textures } from '../textures';
import { weaponModel } from './weapons';

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
const MODEL_SCALE = 1.18;

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

interface Leg {
  pivot: THREE.Group;
}

/**
 * Top-down 3D operator: plate carrier with pouches, backpack with antenna,
 * helmet with rails / NVG mount and glowing goggles, shoulder pads, legs with
 * knee pads and boots, two-handed weapon hold. Faces +X locally; the body
 * group rotates to aim. Animations: walk, idle breathing, recoil, reload,
 * hit flinch and a death fall.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly torsoMat: THREE.MeshStandardMaterial;
  private readonly legs: Leg[] = [];
  private readonly gunHolder = new THREE.Group();
  private readonly flash: THREE.Sprite;
  private readonly bountyRing: THREE.Mesh;
  private readonly extractRing: THREE.Mesh;
  private readonly extractBeam: THREE.Mesh;
  private readonly disconnectRing: THREE.Mesh;
  /** KINGPIN: gold ring + floating gem (visible to everyone nearby). */
  private readonly kingpinRing: THREE.Mesh;
  private readonly kingpinGem: THREE.Mesh;
  private readonly markers: THREE.Mesh[];
  private weapon: WeaponId | null | undefined = undefined;
  private muzzle = 20;
  private phase = Math.random() * 10;
  private lastX = NaN;
  private lastY = NaN;
  private recoil = 0;
  private flashT = 0;
  private hitT = 0;
  private reloadT = 0;
  private deathT = -1;
  private deathSide = 1;
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
      b.add(pivot);
      this.legs.push({ pivot });
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

    // Arms: right hand on the grip, left hand on the handguard.
    const rShoulder = new THREE.Vector3(1, 31, -10);
    const lShoulder = new THREE.Vector3(1, 31, 10);
    const rElbow = new THREE.Vector3(8, 25, -11);
    const lElbow = new THREE.Vector3(13, 26, 6);
    const rHand = new THREE.Vector3(15, 26, -3);
    const lHand = new THREE.Vector3(25, 27, 0.5);
    u.add(bone(shirt, rShoulder, rElbow, 3.4), bone(shirt, rElbow, rHand, 3));
    u.add(bone(shirt, lShoulder, lElbow, 3.4), bone(shirt, lElbow, lHand, 3));
    u.add(mesh(sphere, gloves, [3.4, 3.4, 3.4], [rHand.x, rHand.y, rHand.z]));
    u.add(mesh(sphere, gloves, [3.4, 3.4, 3.4], [lHand.x, lHand.y, lHand.z]));

    this.gunHolder.position.set(14, 27.5, -1.5);
    u.add(this.gunHolder);

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: Textures.flash(), color: 0xffd8a0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.flash.scale.set(40, 40, 1);
    this.flash.visible = false;
    this.gunHolder.add(this.flash);

    this.body.scale.setScalar(MODEL_SCALE);
    this.root.add(this.body);

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
    this.flash.position.set(this.muzzle + 10, 1, 0);
  }

  /** Called when this character fires (bullet spawn seen). */
  fire(): void {
    this.recoil = 1;
    this.flashT = 1;
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = 34 + Math.random() * 14;
    this.flash.scale.set(s, s, 1);
  }

  hit(): void {
    this.hitT = 1;
  }

  /** Starts the death fall; `side` picks which way the body topples. */
  die(side: number): void {
    if (this.deathT >= 0) return;
    this.deathT = 0;
    this.deathSide = side >= 0 ? 1 : -1;
    for (const m of this.markers) m.visible = false;
    this.flash.visible = false;
  }

  get dead(): boolean {
    return this.deathT >= 0;
  }

  /** Advances the death animation; returns false once the body should be removed. */
  updateDeath(dt: number): boolean {
    this.deathT += dt;
    const fall = Math.min(1, this.deathT / 0.42);
    const ease = 1 - Math.pow(1 - fall, 3);
    // Topple sideways, knees buckle, gun drops.
    this.body.rotation.x = this.deathSide * ease * 1.45;
    this.body.position.y = -ease * 4;
    this.upper.rotation.z = -ease * 0.3;
    this.gunHolder.rotation.z = -ease * 0.9;
    for (const l of this.legs) l.pivot.rotation.z = ease * 0.5;
    const fade = this.deathT > 4 ? Math.max(0, 1 - (this.deathT - 4) / 1.2) : 1;
    this.root.position.y = -(1 - fade) * 20;
    return fade > 0;
  }

  update(x: number, y: number, rot: number, flags: number, dt: number, time: number): void {
    this.root.position.set(x, 0, y);
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
      l.pivot.rotation.z += (sw * amp * Math.sign(fwd || 1) * Math.abs(fwd) - l.pivot.rotation.z) * Math.min(1, dt * 16);
      l.pivot.rotation.x += (Math.sin(rel) * amp * 0.5 * sw - l.pivot.rotation.x) * Math.min(1, dt * 16);
    });
    const bob = walking ? Math.abs(Math.cos(this.phase)) * 1.6 : Math.sin(time / 650) * 0.35;
    this.upper.position.y = bob;
    this.body.rotation.z = -Math.min(1, speed / 260) * 0.08 * fwd;

    // Recoil kick (gun + shoulders) and muzzle flash.
    this.recoil = Math.max(0, this.recoil - dt * 11);
    this.gunHolder.position.x = 14 - this.recoil * 5;
    this.upper.rotation.y = this.recoil * 0.06;
    this.flashT = Math.max(0, this.flashT - dt * 22);
    this.flash.visible = this.flashT > 0;
    this.flash.material.opacity = this.flashT;

    // Reload: weapon tilts down and rolls, then comes back.
    const reloading = (flags & PLAYER_FLAGS.RELOADING) !== 0;
    this.reloadT += ((reloading ? 1 : 0) - this.reloadT) * Math.min(1, dt * 10);
    const wiggle = reloading ? Math.sin(time / 110) * 0.08 : 0;
    this.gunHolder.rotation.z = -this.reloadT * 0.55 + wiggle;
    this.gunHolder.rotation.x = this.reloadT * 0.5;

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

  dispose(): void {
    this.torsoMat.dispose();
    this.flash.material.dispose();
    this.root.removeFromParent();
  }
}
