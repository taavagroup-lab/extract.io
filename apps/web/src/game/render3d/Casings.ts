import type { CasingType } from '@extract/game-types';
import * as THREE from 'three';

const MAX = 200;
const LIFE = 2.4;
const FADE = 0.5;
const GRAVITY = 900;

interface Casing {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spin axis angle / rotation state. */
  yaw: number;
  roll: number;
  spin: number;
  age: number;
  radius: number;
  length: number;
  bounces: number;
}

const SIZE: Record<Exclude<CasingType, 'none'>, { r: number; len: number; color: number }> = {
  pistol: { r: 0.85, len: 2.6, color: 0xd6a646 },
  rifle: { r: 0.8, len: 4.2, color: 0xd9ab4c },
  heavy: { r: 1.05, len: 5.4, color: 0xc99a3e },
  shell: { r: 1.7, len: 6.2, color: 0xb3261e },
};

/**
 * Pooled 3D shell casings (one instanced draw call). Casings fly out of the
 * ejection port, tumble, bounce on the ground a couple of times with a
 * little skid, then shrink away. Plain CPU physics: a few hundred at most.
 */
export class CasingPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly items: Casing[] = [];
  private cursor = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  density = 1;

  constructor() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 7).rotateZ(Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.75 });
    this.mesh = new THREE.InstancedMesh(geo, material, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < MAX; i++) {
      this.items.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, roll: 0, spin: 0, age: 0, radius: 1, length: 1, bounces: 0 });
      this.mesh.setColorAt(i, this.c.setHex(0xd6a646));
    }
  }

  /** Ejects a casing from (x, y, z) to the weapon's right (-Z side of the aim). */
  eject(x: number, y: number, z: number, aim: number, type: CasingType): void {
    if (type === 'none' || Math.random() > this.density) return;
    const size = SIZE[type];
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    const c = this.items[i]!;
    const side = aim - Math.PI / 2 + (Math.random() - 0.5) * 0.5;
    const back = aim + Math.PI;
    const sp = type === 'shell' ? 70 + Math.random() * 40 : 95 + Math.random() * 60;
    c.alive = true;
    c.x = x;
    c.y = y;
    c.z = z;
    c.vx = Math.cos(side) * sp + Math.cos(back) * 25;
    c.vz = Math.sin(side) * sp + Math.sin(back) * 25;
    c.vy = 110 + Math.random() * 70;
    c.yaw = aim + Math.random() * Math.PI;
    c.roll = Math.random() * Math.PI;
    c.spin = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 12);
    c.age = 0;
    c.radius = size.r;
    c.length = size.len;
    c.bounces = 0;
    this.mesh.setColorAt(i, this.c.setHex(size.color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const d = Math.min(dt, 0.05);
    let top = 0;
    for (let i = 0; i < MAX; i++) {
      const c = this.items[i]!;
      if (!c.alive) {
        this.m4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m4);
        continue;
      }
      c.age += d;
      if (c.age >= LIFE) {
        c.alive = false;
        this.m4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m4);
        continue;
      }
      top = i + 1;
      const floor = c.radius + 0.4;
      if (c.y > floor || c.vy > 0) {
        c.vy -= GRAVITY * d;
        c.x += c.vx * d;
        c.y += c.vy * d;
        c.z += c.vz * d;
        c.yaw += c.spin * d * 0.35;
        c.roll += c.spin * d;
        if (c.y <= floor && c.vy < 0) {
          c.y = floor;
          c.bounces++;
          // Bounce: lose most energy, skid, spin slows.
          c.vy = c.bounces < 3 ? -c.vy * 0.32 : 0;
          c.vx *= 0.55;
          c.vz *= 0.55;
          c.spin *= 0.5;
        }
      } else {
        // Resting: tiny skid, lies on its side.
        c.x += c.vx * d;
        c.z += c.vz * d;
        c.vx *= Math.exp(-d * 8);
        c.vz *= Math.exp(-d * 8);
        c.roll = Math.PI / 2;
      }
      const shrink = c.age > LIFE - FADE ? (LIFE - c.age) / FADE : 1;
      this.p.set(c.x, c.y, c.z);
      this.q.setFromEuler(this.e.set(c.roll, c.yaw, 0, 'YXZ'));
      this.s.set(c.length * shrink, c.radius * shrink, c.radius * shrink);
      this.m4.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.count = top;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
