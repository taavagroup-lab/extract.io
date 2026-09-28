import type { ContainerType } from '@extract/game-types';
import * as THREE from 'three';
import { decalMat, glow, mat } from '../materials';
import { CRATE_STYLE } from '../style';
import { Decals, Textures } from '../textures';

const cube = new THREE.BoxGeometry(1, 1, 1);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
const ringGeo = new THREE.RingGeometry(0.9, 1, 48);
const flatQuad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function box(material: THREE.Material, s: [number, number, number], p: [number, number, number], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(cube, material);
  m.scale.set(...s);
  m.position.set(...p);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/**
 * Loot container per tier: wooden supply crate, olive military hard case,
 * blue tech case with a glowing seam, armoured legendary case with gold trim,
 * holo ring and light, orange supply drop. Animated lid; locked vault crates
 * show a glowing padlock.
 */
export class CrateModel {
  readonly root = new THREE.Group();
  private readonly lidPivot = new THREE.Group();
  private readonly lock: THREE.Group;
  private readonly beam: THREE.Mesh | null = null;
  private readonly holo: THREE.Mesh | null = null;
  private readonly pool: THREE.Mesh | null = null;
  private lidAngle = 0;
  private opened: boolean;
  private readonly size: number;
  readonly glowColor: number | null;

  constructor(
    readonly type: ContainerType,
    x: number,
    y: number,
    opened: boolean,
    locked: boolean,
  ) {
    const s = CRATE_STYLE[type];
    this.size = s.size;
    this.glowColor = s.glow;
    const L = s.size;
    const wooden = type === 'NORMAL';
    const h = s.size * (wooden ? 0.72 : 0.6);
    const depth = L * (wooden ? 1 : 0.72);
    const tex = wooden ? Textures.crateWood() : Textures.hardCase();
    const shell = mat(s.color, { map: tex.map, normalMap: tex.normalMap, rough: wooden ? 0.8 : 0.55, metal: wooden ? 0 : 0.25 });
    const trim = mat(s.trim, { rough: 0.45, metal: type === 'LEGENDARY' ? 0.95 : 0.5 });

    // Contact shadow.
    const contact = new THREE.Mesh(flatQuad, decalMat('shade', Decals.softShadow(), 0x000000, 0.6));
    contact.scale.set(L + 26, 1, depth + 26);
    contact.position.y = 2.2;
    contact.renderOrder = 1;
    this.root.add(contact);

    this.root.add(box(shell, [L, h, depth], [0, h / 2, 0]));
    if (wooden) {
      // Metal corner brackets.
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) this.root.add(box(trim, [4, h + 1, 4], [(cx * (L - 3)) / 2, h / 2, (cz * (depth - 3)) / 2]));
    } else {
      // Moulded bumpers, latches and handles.
      this.root.add(box(trim, [L + 1.5, 3, depth + 1.5], [0, 3, 0]));
      for (const cx of [-L / 3, L / 3]) this.root.add(box(trim, [5, 5, 2], [cx, h - 5, depth / 2 + 0.8]));
      for (const side of [-1, 1]) this.root.add(box(trim, [2, 3, 10], [side * (L / 2 + 0.8), h * 0.6, 0]));
    }
    // Dark interior shown when the lid is open.
    this.root.add(box(mat(0x0b0c0e, { rough: 1 }), [L - 6, 1, depth - 6], [0, h + 0.2, 0], false));

    // Lid hinged on the back (-Z) edge.
    this.lidPivot.position.set(0, h, -depth / 2);
    this.lidPivot.add(box(shell, [L + 2, wooden ? 5 : 6, depth + 2], [0, wooden ? 2.5 : 3, depth / 2]));
    if (!wooden && s.glow !== null) {
      this.lidPivot.add(box(glow(s.glow, 1, null, 2.4), [L + 2.4, 1.2, 1.6], [0, 0.6, depth + 1], false));
      this.lidPivot.add(box(glow(s.glow, 1, null, 2), [L * 0.4, 0.8, depth * 0.3], [0, 6.2, depth / 2], false));
    }
    if (type === 'LEGENDARY') {
      for (const cz of [0.15, 0.85]) this.lidPivot.add(box(trim, [L + 2.6, 1.4, 2], [0, 6.3, depth * cz]));
    }
    if (type === 'MILITARY') {
      this.lidPivot.add(box(mat(0xd8d2b8, { rough: 0.8 }), [L * 0.5, 0.4, depth * 0.22], [0, 6.2, depth / 2], false));
    }
    if (type === 'SUPPLY_DROP') {
      this.lidPivot.add(box(mat(0xf2f2f0, { rough: 0.6 }), [L + 2.2, 6.4, 8], [0, 3, depth / 2]));
    }
    this.root.add(this.lidPivot);

    // Padlock (vault crates before the combat phase).
    this.lock = new THREE.Group();
    const lockBody = box(glow(0xf59e0b, 1, null, 2.2), [8, 7, 3], [0, 0, 0], false);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(3, 0.9, 6, 12, Math.PI), glow(0xf59e0b, 1, null, 2.2));
    shackle.position.y = 3.5;
    this.lock.add(lockBody, shackle);
    this.lock.position.set(0, h * 0.55, depth / 2 + 2);
    this.root.add(this.lock);

    if (s.glow !== null) {
      this.pool = new THREE.Mesh(flatQuad, decalMat('additive', Decals.lightPool(), s.glow, type === 'LEGENDARY' ? 0.5 : 0.32));
      this.pool.scale.set(L * 3, 1, L * 3);
      this.pool.position.y = 2.5;
      this.pool.renderOrder = 3;
      this.root.add(this.pool);
    }
    if (type === 'LEGENDARY' || type === 'SUPPLY_DROP') {
      this.beam = new THREE.Mesh(beamGeo, glow(s.glow ?? 0xffffff, 0.2, Textures.beam(), 1.2));
      this.beam.scale.set(L * 0.3, 110, L * 0.3);
      this.beam.position.y = 55 + h;
      this.root.add(this.beam);
    }
    if (type === 'LEGENDARY') {
      this.holo = new THREE.Mesh(ringGeo, glow(0xf5c542, 0.8, null, 2.6).clone());
      this.holo.rotation.x = -Math.PI / 2;
      this.holo.scale.setScalar(L * 0.75);
      this.holo.position.y = h + 22;
      this.root.add(this.holo);
    }

    this.opened = opened;
    this.lidAngle = opened ? 1 : 0;
    this.applyLid();
    this.setState(opened, locked);
    this.root.position.set(x, 0, y);
  }

  /** Returns true when the crate just transitioned to opened. */
  setState(opened: boolean, locked: boolean): boolean {
    const justOpened = opened && !this.opened;
    this.opened = opened;
    this.lock.visible = locked && !opened;
    if (this.beam) this.beam.visible = !opened;
    if (this.holo) this.holo.visible = !opened;
    if (this.pool) this.pool.visible = !opened;
    return justOpened;
  }

  private applyLid(): void {
    this.lidPivot.rotation.x = -this.lidAngle * 1.95;
  }

  update(dt: number, time: number): void {
    const target = this.opened ? 1 : 0;
    if (this.lidAngle !== target) {
      this.lidAngle += Math.sign(target - this.lidAngle) * Math.min(Math.abs(target - this.lidAngle), dt * 6);
      this.applyLid();
    }
    if (this.lock.visible) this.lock.position.y = this.size * 0.4 + Math.sin(time / 250) * 1.2;
    if (this.holo?.visible) {
      this.holo.rotation.z = time / 900;
      this.holo.position.y = this.size * 0.6 + 22 + Math.sin(time / 400) * 2;
      (this.holo.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(time / 300);
    }
    if (this.pool?.visible) this.pool.scale.setScalar(this.size * (2.8 + 0.25 * Math.sin(time / 500)));
  }

  dispose(): void {
    if (this.holo) (this.holo.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}

/** A supply crate hanging under a parachute, used while the drop is falling. */
export function createFallingDrop(): THREE.Group {
  const g = new THREE.Group();
  const crate = new CrateModel('SUPPLY_DROP', 0, 0, false, false);
  g.add(crate.root);
  const chute = new THREE.Mesh(
    new THREE.SphereGeometry(70, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd9621d, roughness: 0.8, side: THREE.DoubleSide }),
  );
  chute.position.y = 150;
  chute.scale.y = 0.55;
  chute.castShadow = true;
  g.add(chute);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xe5e7eb, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 42, 0), new THREE.Vector3(Math.cos(a) * 66, 150, Math.sin(a) * 66)]);
    g.add(new THREE.Line(geo, lineMat));
  }
  return g;
}
