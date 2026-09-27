import type { ContainerType } from '@extract/game-types';
import * as THREE from 'three';
import { glow, mat } from '../materials';
import { CRATE_STYLE } from '../style';
import { Textures } from '../textures';

const cube = new THREE.BoxGeometry(1, 1, 1);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);

/** Loot container with an animated lid; locked vault crates show a glowing padlock. */
export class CrateModel {
  readonly root = new THREE.Group();
  private readonly lidPivot = new THREE.Group();
  private readonly lock: THREE.Group;
  private readonly beam: THREE.Mesh | null = null;
  private lidAngle = 0;
  private opened: boolean;
  private readonly size: number;

  constructor(
    readonly type: ContainerType,
    x: number,
    y: number,
    opened: boolean,
    locked: boolean,
  ) {
    const s = CRATE_STYLE[type];
    this.size = s.size;
    const h = s.size * 0.72;
    const wood = mat(s.color, { map: Textures.crateWood(), rough: 0.8 });
    const trim = mat(s.trim, { rough: 0.5, metal: type === 'LEGENDARY' ? 0.9 : 0.2 });

    const base = new THREE.Mesh(cube, wood);
    base.scale.set(s.size, h, s.size);
    base.position.y = h / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    this.root.add(base);
    // Corner posts.
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        const post = new THREE.Mesh(cube, trim);
        post.scale.set(4, h + 1, 4);
        post.position.set((cx * (s.size - 3)) / 2, h / 2, (cz * (s.size - 3)) / 2);
        post.castShadow = true;
        this.root.add(post);
      }
    }
    // Dark interior shown when the lid is open.
    const inside = new THREE.Mesh(cube, mat(0x0b0c0e, { rough: 1 }));
    inside.scale.set(s.size - 6, 1, s.size - 6);
    inside.position.y = h + 0.2;
    this.root.add(inside);

    // Lid hinged on the back (-Z) edge.
    this.lidPivot.position.set(0, h, -s.size / 2);
    const lid = new THREE.Mesh(cube, wood);
    lid.scale.set(s.size + 2, 5, s.size + 2);
    lid.position.set(0, 2.5, s.size / 2);
    lid.castShadow = true;
    this.lidPivot.add(lid);
    if (s.glow !== null) {
      const strip = new THREE.Mesh(cube, glow(s.glow, 1, null, 2.4));
      strip.scale.set(s.size + 2.4, 1.4, 5);
      strip.position.set(0, 5.4, s.size / 2);
      this.lidPivot.add(strip);
    }
    if (type === 'SUPPLY_DROP') {
      const stripe = new THREE.Mesh(cube, mat(0xf8fafc, { rough: 0.6 }));
      stripe.scale.set(s.size + 2.2, 5.2, 8);
      stripe.position.set(0, 2.5, s.size / 2);
      this.lidPivot.add(stripe);
    }
    this.root.add(this.lidPivot);

    // Padlock (vault crates before the combat phase).
    this.lock = new THREE.Group();
    const lockBody = new THREE.Mesh(cube, glow(0xf59e0b, 1, null, 2.2));
    lockBody.scale.set(8, 7, 3);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(3, 0.9, 6, 12, Math.PI), glow(0xf59e0b, 1, null, 2.2));
    shackle.position.y = 3.5;
    this.lock.add(lockBody, shackle);
    this.lock.position.set(0, h * 0.55, s.size / 2 + 2);
    this.root.add(this.lock);

    if (type === 'LEGENDARY' || type === 'SUPPLY_DROP') {
      this.beam = new THREE.Mesh(beamGeo, glow(s.glow ?? 0xffffff, 0.2, Textures.beam(), 1.2));
      this.beam.scale.set(s.size * 0.3, 110, s.size * 0.3);
      this.beam.position.y = 55 + s.size * 0.72;
      this.root.add(this.beam);
    }

    this.opened = opened;
    this.lidAngle = opened ? 1 : 0;
    this.applyLid();
    this.setState(opened, locked);
    this.root.position.set(x, 0, y);
  }

  setState(opened: boolean, locked: boolean): void {
    this.opened = opened;
    this.lock.visible = locked && !opened;
    if (this.beam) this.beam.visible = !opened;
  }

  private applyLid(): void {
    this.lidPivot.rotation.x = -this.lidAngle * 1.95;
  }

  update(dt: number, time: number): void {
    const target = this.opened ? 1 : 0;
    if (this.lidAngle !== target) {
      this.lidAngle += Math.sign(target - this.lidAngle) * Math.min(Math.abs(target - this.lidAngle), dt * 5);
      this.applyLid();
    }
    if (this.lock.visible) this.lock.position.y = this.size * 0.4 + Math.sin(time / 250) * 1.2;
  }

  dispose(): void {
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
    new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.8, side: THREE.DoubleSide }),
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
