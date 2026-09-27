import { MATCH_CONFIG, weaponFromIndex } from '@extract/game-config';
import type { MatchGlobalState } from '@extract/game-types';
import * as THREE from 'three';
import type { GameClient } from '../net/GameClient';
import { glow } from './materials';
import { createFallingDrop } from './models/CrateModel';
import { COLORS, GUN_HEIGHT } from './style';
import { Textures } from './textures';

const MAX_TRACERS = 600;
const MAX_SPARKS = 160;
const TRACER_LEN = 36;
const DROP_HEIGHT = 1500;

interface Spark {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  life: number;
  size: number;
  active: boolean;
}

interface ZoneVisual {
  group: THREE.Group;
  ring: THREE.Mesh;
  disc: THREE.Mesh;
  beam: THREE.Mesh;
  particles: THREE.Points;
  seeds: Float32Array;
}

const ringGeo = new THREE.RingGeometry(0.95, 1, 96);
const discGeo = new THREE.CircleGeometry(1, 64);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);

/** All transient / dynamic visuals that are not tied to a single entity. */
export class Effects {
  readonly root = new THREE.Group();
  private readonly tracers: THREE.InstancedMesh;
  private readonly sparks: Spark[] = [];
  private sparkCursor = 0;
  private readonly seenBullets = new Set<number>();
  private readonly zones = new Map<string, ZoneVisual>();
  private readonly bountyRings: THREE.Mesh[] = [];
  private readonly drops = new Map<number, { marker: THREE.Mesh; beam: THREE.Mesh; falling: THREE.Group | null }>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly onFire: (ownerId: number) => void) {
    this.tracers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      MAX_TRACERS,
    );
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.root.add(this.tracers);

    const sparkMat = () =>
      new THREE.SpriteMaterial({ map: Textures.radial(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true });
    for (let i = 0; i < MAX_SPARKS; i++) {
      const sprite = new THREE.Sprite(sparkMat());
      sprite.visible = false;
      this.root.add(sprite);
      this.sparks.push({ sprite, vx: 0, vy: 0, vz: 0, born: 0, life: 1, size: 1, active: false });
    }
  }

  spark(x: number, y: number, z: number, color: number, size: number, life: number, velocity?: [number, number, number]): void {
    const sp = this.sparks[this.sparkCursor++ % MAX_SPARKS]!;
    sp.active = true;
    sp.sprite.visible = true;
    sp.sprite.position.set(x, y, z);
    (sp.sprite.material as THREE.SpriteMaterial).color.setHex(color).multiplyScalar(2.5);
    sp.size = size;
    sp.life = life;
    sp.born = performance.now();
    [sp.vx, sp.vy, sp.vz] = velocity ?? [0, 0, 0];
  }

  deathBurst(x: number, z: number): void {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 140;
      this.spark(x, 24, z, i % 3 === 0 ? 0xffffff : COLORS.danger, 10 + Math.random() * 8, 450 + Math.random() * 300, [Math.cos(a) * sp, 60 + Math.random() * 120, Math.sin(a) * sp]);
    }
    this.spark(x, 10, z, 0xff6b3d, 90, 380);
  }

  update(client: GameClient, dt: number, time: number): void {
    this.updateBullets(client);
    this.updateSparks(dt);
    this.updateGlobal(client, client.global, time);
  }

  private updateBullets(client: GameClient): void {
    const now = performance.now();
    let n = 0;
    const bullets = client.bullets;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]!;
      const weapon = weaponFromIndex(b.weapon);
      if (!this.seenBullets.has(b.id)) {
        this.seenBullets.add(b.id);
        this.onFire(b.ownerId);
        this.spark(b.x0 + b.dx * 44, GUN_HEIGHT + 2, b.y0 + b.dy * 44, 0xffd27a, 26, 70);
      }
      const end = b.endDist ?? b.maxDist;
      const dist = ((now - b.born) / 1000) * b.speed + 30;
      if (dist >= end) {
        const hx = b.x0 + b.dx * end;
        const hz = b.y0 + b.dy * end;
        if (b.hitPlayer) {
          this.spark(hx, GUN_HEIGHT, hz, COLORS.danger, 26, 200);
          for (let k = 0; k < 4; k++) this.spark(hx, GUN_HEIGHT, hz, 0xff8080, 6, 260, [(Math.random() - 0.5) * 200, 80 + Math.random() * 80, (Math.random() - 0.5) * 200]);
        } else {
          this.spark(hx, GUN_HEIGHT, hz, 0xfff1c4, 14, 130);
          for (let k = 0; k < 3; k++) this.spark(hx, GUN_HEIGHT, hz, 0xffd27a, 4, 220, [(Math.random() - 0.5) * 160, 60 + Math.random() * 100, (Math.random() - 0.5) * 160]);
        }
        bullets.splice(i, 1);
        this.seenBullets.delete(b.id);
        continue;
      }
      if (n >= MAX_TRACERS) continue;
      const head = Math.min(dist, end);
      const tail = Math.max(30, head - TRACER_LEN);
      const mid = (head + tail) / 2;
      this.v.set(b.x0 + b.dx * mid, GUN_HEIGHT, b.y0 + b.dy * mid);
      this.q.setFromAxisAngle(this.up, -Math.atan2(b.dy, b.dx));
      this.s.set(Math.max(1, head - tail), 2.4, 2.4);
      this.m4.compose(this.v, this.q, this.s);
      this.tracers.setMatrixAt(n, this.m4);
      this.c.setHex(weapon?.bulletColor ?? 0xffffff).multiplyScalar(4);
      this.tracers.setColorAt(n, this.c);
      n++;
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    if (this.seenBullets.size > 4000) this.seenBullets.clear();
  }

  private updateSparks(dt: number): void {
    const now = performance.now();
    for (const sp of this.sparks) {
      if (!sp.active) continue;
      const t = (now - sp.born) / sp.life;
      if (t >= 1) {
        sp.active = false;
        sp.sprite.visible = false;
        continue;
      }
      if (sp.vx || sp.vy || sp.vz) {
        sp.vy -= 520 * dt;
        sp.sprite.position.x += sp.vx * dt;
        sp.sprite.position.y = Math.max(2, sp.sprite.position.y + sp.vy * dt);
        sp.sprite.position.z += sp.vz * dt;
      }
      const scale = sp.size * (1 + t * 0.6);
      sp.sprite.scale.set(scale, scale, 1);
      (sp.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
    }
  }

  private zoneVisual(id: string, x: number, z: number, r: number): ZoneVisual {
    let zv = this.zones.get(id);
    if (zv) return zv;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const ring = new THREE.Mesh(ringGeo, glow(COLORS.extraction, 0.9, null, 2));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(r, r, 1);
    ring.position.y = 3;
    const disc = new THREE.Mesh(discGeo, glow(COLORS.extraction, 0.1, Textures.radial(), 1));
    disc.rotation.x = -Math.PI / 2;
    disc.scale.set(r, r, 1);
    disc.position.y = 2.8;
    const beam = new THREE.Mesh(beamGeo, glow(COLORS.extraction, 0.28, Textures.beam(), 1.3));
    beam.scale.set(r * 0.98, 320, r * 0.98);
    beam.position.y = 160;
    const count = 48;
    const seeds = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r * 0.95;
      seeds[i * 3] = Math.cos(a) * rr;
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.sin(a) * rr;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ size: 9, map: Textures.radial(), color: new THREE.Color(COLORS.extraction).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    particles.frustumCulled = false;
    group.add(ring, disc, beam, particles);
    this.root.add(group);
    zv = { group, ring, disc, beam, particles, seeds };
    this.zones.set(id, zv);
    return zv;
  }

  private updateGlobal(client: GameClient, g: MatchGlobalState | null, time: number): void {
    if (!g) return;
    const pulse = 0.5 + 0.5 * Math.sin(time / 260);

    for (const z of g.extractionZones) {
      const zv = this.zoneVisual(z.id, z.position.x, z.position.y, z.radius);
      const busy = z.playersCurrentlyExtracting.length > 0;
      zv.beam.visible = z.active;
      zv.particles.visible = z.active;
      zv.disc.visible = z.active;
      zv.ring.material = z.active ? glow(busy ? COLORS.supply : COLORS.extraction, 0.9, null, 2 + pulse) : glow(0x9ca3af, 0.25, null, 1);
      zv.ring.scale.setScalar(z.radius * (z.active ? 1 + pulse * 0.02 : 1));
      if (z.active) {
        const pos = zv.particles.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const t = (zv.seeds[i * 3 + 1]! + time / 3200) % 1;
          pos.setXYZ(i, zv.seeds[i * 3]!, 6 + t * 240, zv.seeds[i * 3 + 2]!);
        }
        pos.needsUpdate = true;
        (zv.particles.material as THREE.PointsMaterial).opacity = 0.9;
      }
    }

    // Bounty markers (approximate positions).
    while (this.bountyRings.length < g.bounties.length) {
      const m = new THREE.Mesh(ringGeo, glow(COLORS.danger, 0.8, null, 2));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 3.2;
      this.root.add(m);
      this.bountyRings.push(m);
    }
    this.bountyRings.forEach((m, i) => {
      const b = g.bounties[i];
      m.visible = !!b;
      if (b) {
        m.position.x = b.x;
        m.position.z = b.y;
        m.scale.set(b.radius, b.radius, 1);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * pulse;
      }
    });

    // Supply drops: marker + falling crate under a parachute.
    const now = client.serverNow();
    for (const d of g.supplyDrops) {
      let v = this.drops.get(d.id);
      if (!v) {
        const marker = new THREE.Mesh(ringGeo, glow(COLORS.supply, 0.9, null, 2.2));
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(d.x, 3.4, d.y);
        const beam = new THREE.Mesh(beamGeo, glow(COLORS.supply, 0.25, Textures.beam(), 1.4));
        beam.scale.set(40, 700, 40);
        beam.position.set(d.x, 350, d.y);
        this.root.add(marker, beam);
        v = { marker, beam, falling: null };
        this.drops.set(d.id, v);
      }
      if (!d.landed) {
        if (!v.falling) {
          v.falling = createFallingDrop();
          this.root.add(v.falling);
        }
        const remaining = Math.max(0, d.landsAtMs - now);
        const k = Math.min(1, remaining / MATCH_CONFIG.supplyDrops.fallMs);
        v.falling.position.set(d.x + Math.sin(time / 700) * 12 * k, k * DROP_HEIGHT, d.y);
        v.falling.rotation.y = time / 1500;
      } else if (v.falling) {
        v.falling.removeFromParent();
        v.falling = null;
        this.deathBurst(d.x, d.y);
      }
      v.marker.visible = !d.opened;
      v.beam.visible = !d.landed;
      v.marker.scale.setScalar(60 + (1 - pulse) * 30);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.tracers.geometry.dispose();
    (this.tracers.material as THREE.Material).dispose();
    for (const sp of this.sparks) sp.sprite.material.dispose();
    for (const z of this.zones.values()) {
      z.particles.geometry.dispose();
      (z.particles.material as THREE.Material).dispose();
    }
  }
}
