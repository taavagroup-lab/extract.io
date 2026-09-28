import { MATCH_CONFIG, weaponFromIndex } from '@extract/game-config';
import type { MatchGlobalState, ObstacleStyle, WeaponId } from '@extract/game-types';
import * as THREE from 'three';
import type { GameClient } from '../net/GameClient';
import { decalMat, glow } from './materials';
import { createFallingDrop } from './models/CrateModel';
import { ParticlePool } from './Particles';
import { COLORS, GUN_HEIGHT } from './style';
import { Decals, Textures } from './textures';

const MAX_TRACERS = 600;
const TRACER_LEN = 70;
const DROP_HEIGHT = 1500;

type Surface = 'concrete' | 'metal' | 'wood' | 'sand' | 'foliage' | 'rock';

const SURFACE: Record<ObstacleStyle, Surface> = {
  wall: 'concrete',
  barrier: 'concrete',
  vault: 'metal',
  container: 'metal',
  machine: 'metal',
  pump: 'metal',
  generator: 'metal',
  vehicle: 'metal',
  fence: 'metal',
  shelf: 'metal',
  barrel: 'metal',
  crate_stack: 'wood',
  pallet: 'wood',
  sandbag: 'sand',
  tree: 'foliage',
  rock: 'rock',
};

interface ZoneVisual {
  group: THREE.Group;
  ring: THREE.Mesh;
  inner: THREE.Mesh;
  disc: THREE.Mesh;
  beam: THREE.Mesh;
  flood: THREE.Mesh[];
  /** Per-zone materials, mutated every frame (never re-created). */
  ringMat: THREE.MeshBasicMaterial;
  innerMat: THREE.MeshBasicMaterial;
  beaconMat: THREE.MeshBasicMaterial;
  nextMote: number;
}

/** Sets an unlit HDR colour in place: base colour scaled by intensity. */
function tint(m: THREE.MeshBasicMaterial, color: number, intensity: number, opacity: number): void {
  m.color.setHex(color).multiplyScalar(intensity);
  m.opacity = opacity;
}

const ringGeo = new THREE.RingGeometry(0.95, 1, 96);
const discGeo = new THREE.CircleGeometry(1, 64);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
const quadGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** All transient / dynamic visuals that are not tied to a single entity. */
export class Effects {
  readonly root = new THREE.Group();
  /** Glowing particles (sparks, flashes, motes). */
  readonly glowPool: ParticlePool;
  /** Alpha-blended particles (smoke, dust, debris, blood). */
  readonly smokePool: ParticlePool;
  private readonly tracers: THREE.InstancedMesh;
  private readonly seenBullets = new Set<number>();
  private readonly zones = new Map<string, ZoneVisual>();
  private readonly bountyRings: THREE.Mesh[] = [];
  private readonly kingpinRings: THREE.Mesh[] = [];
  private readonly drops = new Map<number, { marker: THREE.Mesh; beam: THREE.Mesh; falling: THREE.Group | null }>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);

  /** onFire: a remote player's shot appeared (not our own: those are predicted). */
  constructor(private readonly onFire: (ownerId: number, weaponIndex: number, x: number, y: number) => void) {
    this.tracers = new THREE.InstancedMesh(
      quadGeo,
      new THREE.MeshBasicMaterial({ map: Textures.tracer(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      MAX_TRACERS,
    );
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.tracers.renderOrder = 10;
    this.glowPool = new ParticlePool(2400, Textures.particle(), 'additive');
    this.smokePool = new ParticlePool(1600, Textures.smoke(), 'normal', 0.12);
    this.root.add(this.tracers, this.smokePool.mesh, this.glowPool.mesh);
  }

  /** Particle budget for the current graphics quality (0..1). */
  setDensity(d: number): void {
    this.glowPool.density = d;
    this.smokePool.density = d;
  }

  // ------------------------------------------------------------------ emitters

  /** Small dust puff at a character's feet (running). */
  dust(x: number, z: number): void {
    this.smokePool.spawn({ x: x + rnd(-7, 7), y: 3, z: z + rnd(-7, 7), vx: rnd(-18, 18), vy: rnd(8, 20), vz: rnd(-18, 18), drag: 2.5, color: 0x6f675c, alpha: 0.35, size: 10, endSize: 26, life: 650 });
  }

  /** Glowing streak left behind while dashing. */
  trail(x: number, z: number, color: number): void {
    this.glowPool.spawn({ x, y: 22, z, color, intensity: 2.2, alpha: 0.7, size: 26, endSize: 8, life: 260 });
    this.smokePool.spawn({ x, y: 6, z, vy: 10, drag: 2, color: 0x8a8377, alpha: 0.25, size: 16, endSize: 34, life: 500 });
  }

  /** Muzzle flash sparks + a little smoke drifting away from the barrel. */
  muzzle(x: number, z: number, angle: number, weapon: WeaponId | null): void {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const heavy = weapon === 'shotgun';
    this.glowPool.spawn({ x, y: GUN_HEIGHT + 2, z, color: 0xffc46b, intensity: 4, size: heavy ? 44 : 30, endSize: 10, life: 70 });
    const n = heavy ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const a = angle + rnd(-0.35, 0.35);
      const sp = rnd(260, 620);
      this.glowPool.spawn({ x, y: GUN_HEIGHT + 2, z, vx: Math.cos(a) * sp, vy: rnd(-20, 60), vz: Math.sin(a) * sp, drag: 9, color: 0xffb454, intensity: 3.5, size: 2.2, life: rnd(90, 170), stretch: 0.05 });
    }
    this.smokePool.spawn({ x: x + dx * 6, y: GUN_HEIGHT, z: z + dz * 6, vx: dx * 40, vy: 20, vz: dz * 40, drag: 3, color: 0x9a968d, alpha: heavy ? 0.4 : 0.22, size: heavy ? 14 : 9, endSize: heavy ? 46 : 28, life: heavy ? 900 : 600 });
  }

  /** Brass casing flicked out to the right of the weapon. */
  shell(x: number, z: number, angle: number): void {
    const side = angle + Math.PI / 2;
    const sp = rnd(90, 150);
    this.glowPool.spawn({
      x,
      y: GUN_HEIGHT,
      z,
      vx: Math.cos(side) * sp + rnd(-20, 20),
      vy: rnd(90, 150),
      vz: Math.sin(side) * sp + rnd(-20, 20),
      gravity: 700,
      drag: 1.5,
      color: 0xd9a441,
      intensity: 1.3,
      size: 2.4,
      life: 700,
      stretch: 0.01,
    });
  }

  /** Bullet hitting the world: reaction depends on the surface. */
  impact(x: number, z: number, dirX: number, dirZ: number, surface: ObstacleStyle | null): void {
    const kind: Surface = surface ? SURFACE[surface] : 'concrete';
    const back = Math.atan2(-dirZ, -dirX);
    const burst = (n: number, speed: [number, number], spread: number, fn: (vx: number, vy: number, vz: number) => void) => {
      for (let i = 0; i < n; i++) {
        const a = back + rnd(-spread, spread);
        const sp = rnd(speed[0], speed[1]);
        fn(Math.cos(a) * sp, rnd(40, 160), Math.sin(a) * sp);
      }
    };
    const y = GUN_HEIGHT;
    switch (kind) {
      case 'metal':
        this.glowPool.spawn({ x, y, z, color: 0xfff1c4, intensity: 3.5, size: 16, endSize: 4, life: 90 });
        burst(8, [180, 420], 1.1, (vx, vy, vz) =>
          this.glowPool.spawn({ x, y, z, vx, vy, vz, gravity: 520, drag: 2, color: 0xffb347, intensity: 3.2, size: 1.8, life: rnd(180, 380), stretch: 0.045 }),
        );
        this.smokePool.spawn({ x, y, z, vy: 18, drag: 2, color: 0x6e6a64, alpha: 0.25, size: 6, endSize: 20, life: 450 });
        break;
      case 'wood':
        burst(6, [90, 220], 0.9, (vx, vy, vz) =>
          this.smokePool.spawn({ x, y, z, vx, vy, vz, gravity: 600, drag: 1.5, color: 0x8b6a42, alpha: 0.95, size: 3.4, endSize: 2.4, life: rnd(350, 600), spin: rnd(-12, 12) }),
        );
        this.smokePool.spawn({ x, y, z, vx: Math.cos(back) * 30, vy: 20, vz: Math.sin(back) * 30, drag: 2.5, color: 0xa08560, alpha: 0.35, size: 8, endSize: 26, life: 600 });
        break;
      case 'sand':
        burst(10, [60, 180], 1.2, (vx, vy, vz) =>
          this.smokePool.spawn({ x, y, z, vx, vy, vz, gravity: 520, drag: 1.2, color: 0xb59c70, alpha: 0.9, size: 2, endSize: 1.5, life: rnd(300, 500) }),
        );
        this.smokePool.spawn({ x, y, z, vx: Math.cos(back) * 40, vy: 25, vz: Math.sin(back) * 40, drag: 2.5, color: 0xb8a27a, alpha: 0.45, size: 10, endSize: 36, life: 800 });
        break;
      case 'foliage':
        burst(6, [60, 160], 1.4, (vx, vy, vz) =>
          this.smokePool.spawn({ x, y: y + 20, z, vx, vy, vz, gravity: 160, drag: 2.5, color: 0x3e5a2c, alpha: 0.9, size: 3.2, life: rnd(600, 1000), spin: rnd(-8, 8) }),
        );
        break;
      default:
        // Concrete / rock: chips + a dusty puff + a couple of sparks.
        this.glowPool.spawn({ x, y, z, color: 0xfff1c4, intensity: 2.5, size: 10, endSize: 3, life: 70 });
        burst(5, [120, 260], 1, (vx, vy, vz) =>
          this.smokePool.spawn({ x, y, z, vx, vy, vz, gravity: 620, drag: 1.2, color: 0x6d6b66, alpha: 1, size: 2.4, endSize: 2, life: rnd(300, 520) }),
        );
        burst(2, [200, 380], 0.8, (vx, vy, vz) =>
          this.glowPool.spawn({ x, y, z, vx, vy, vz, gravity: 520, drag: 2, color: 0xffc46b, intensity: 3, size: 1.6, life: 160, stretch: 0.04 }),
        );
        this.smokePool.spawn({ x, y, z, vx: Math.cos(back) * 34, vy: 22, vz: Math.sin(back) * 34, drag: 2.4, color: 0x9d988e, alpha: 0.42, size: 8, endSize: 30, life: 750 });
    }
  }

  /** A bullet hit a character: stylised blood mist, or blue sparks when armour took it. */
  playerHit(x: number, z: number, dirX: number, dirZ: number, armor: boolean): void {
    const y = GUN_HEIGHT + 2;
    const fwd = Math.atan2(dirZ, dirX);
    if (armor) {
      this.glowPool.spawn({ x, y, z, color: 0x7dd3fc, intensity: 3.5, size: 18, endSize: 6, life: 110 });
      for (let i = 0; i < 7; i++) {
        const a = fwd + Math.PI + rnd(-1.2, 1.2);
        const sp = rnd(150, 320);
        this.glowPool.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: rnd(40, 140), vz: Math.sin(a) * sp, gravity: 500, drag: 2.5, color: 0x93e2ff, intensity: 3, size: 1.8, life: rnd(160, 300), stretch: 0.04 });
      }
      return;
    }
    this.smokePool.spawn({ x, y, z, vx: dirX * 50, vy: 10, vz: dirZ * 50, drag: 3, color: 0x7a1016, alpha: 0.7, size: 8, endSize: 24, life: 380 });
    for (let i = 0; i < 6; i++) {
      const a = fwd + rnd(-0.7, 0.7);
      const sp = rnd(80, 220);
      this.smokePool.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: rnd(30, 110), vz: Math.sin(a) * sp, gravity: 620, drag: 1.4, color: 0x8e141b, alpha: 0.95, size: 2.4, endSize: 1.8, life: rnd(260, 460) });
    }
  }

  deathBurst(x: number, z: number): void {
    this.glowPool.spawn({ x, y: 16, z, color: 0xff6b3d, intensity: 2.2, size: 70, endSize: 20, life: 260 });
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(70, 200);
      this.smokePool.spawn({ x, y: 24, z, vx: Math.cos(a) * sp, vy: rnd(40, 140), vz: Math.sin(a) * sp, gravity: 600, drag: 1.2, color: 0x7a1016, alpha: 0.95, size: 3, endSize: 2, life: rnd(350, 650) });
    }
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smokePool.spawn({ x, y: 6, z, vx: Math.cos(a) * 50, vy: 14, vz: Math.sin(a) * 50, drag: 1.8, color: 0x7d766b, alpha: 0.4, size: 16, endSize: 48, life: 1100 });
    }
  }

  /** Loot picked up / dropped: rarity sparkles rising, bigger for better items. */
  lootBurst(x: number, z: number, color: number, rank: number): void {
    const n = 6 + rank * 6;
    this.glowPool.spawn({ x, y: 14, z, color, intensity: 2 + rank, size: 30 + rank * 16, endSize: 6, life: 260 + rank * 60 });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(20, 70 + rank * 20);
      this.glowPool.spawn({ x: x + Math.cos(a) * 6, y: 10, z: z + Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: rnd(80, 180 + rank * 40), vz: Math.sin(a) * sp, drag: 2.2, color, intensity: 2.5 + rank * 0.5, size: 2.4 + rank * 0.4, endSize: 0.5, life: rnd(500, 900 + rank * 150) });
    }
  }

  /** Crate lid opening: dust + a flash in the container's colour. */
  crateOpen(x: number, z: number, color: number | null, big: boolean): void {
    for (let i = 0; i < (big ? 8 : 5); i++) {
      const a = Math.random() * Math.PI * 2;
      this.smokePool.spawn({ x: x + Math.cos(a) * 14, y: 30, z: z + Math.sin(a) * 14, vx: Math.cos(a) * 40, vy: rnd(20, 50), vz: Math.sin(a) * 40, drag: 2.4, color: 0x8b8272, alpha: 0.4, size: 10, endSize: 34, life: 800 });
    }
    if (color !== null) this.lootBurst(x, z, color, big ? 4 : 2);
  }

  // ------------------------------------------------------------------ frame

  update(client: GameClient, _dt: number, time: number): void {
    this.updateBullets(client);
    this.updateGlobal(client, client.global, time);
    const t = time / 1000;
    this.glowPool.update(t);
    this.smokePool.update(t);
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
        if (!b.local && !b.ghost) {
          this.onFire(b.ownerId, b.weapon, b.x0, b.y0);
          this.muzzle(b.x0 + b.dx * 34, b.y0 + b.dy * 34, Math.atan2(b.dy, b.dx), weapon?.id ?? null);
        }
      }
      const end = b.endDist ?? b.maxDist;
      const dist = ((now - b.born) / 1000) * b.speed + 30;
      if (dist >= end) {
        const hx = b.x0 + b.dx * end;
        const hz = b.y0 + b.dy * end;
        // Ghosts (server copies of our own shots) only confirm player hits;
        // the predicted tracer already showed the wall impact.
        if (b.hitPlayer) this.playerHit(hx, hz, b.dx, b.dy, false);
        else if (!b.ghost && end < b.maxDist + 1 && b.surface) this.impact(hx, hz, b.dx, b.dy, b.surface);
        bullets.splice(i, 1);
        this.seenBullets.delete(b.id);
        continue;
      }
      if (n >= MAX_TRACERS || b.ghost) continue;
      const head = Math.min(dist, end);
      const tail = Math.max(30, head - TRACER_LEN);
      const mid = (head + tail) / 2;
      this.v.set(b.x0 + b.dx * mid, GUN_HEIGHT, b.y0 + b.dy * mid);
      this.q.setFromAxisAngle(this.up, -Math.atan2(b.dy, b.dx));
      this.s.set(Math.max(1, head - tail), 1, weapon?.id === 'shotgun' ? 2.4 : 3.2);
      this.m4.compose(this.v, this.q, this.s);
      this.tracers.setMatrixAt(n, this.m4);
      this.c.setHex(weapon?.bulletColor ?? 0xffffff).multiplyScalar(3.4);
      this.tracers.setColorAt(n, this.c);
      n++;
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    if (this.seenBullets.size > 4000) this.seenBullets.clear();
  }

  private zoneVisual(id: string, x: number, z: number, r: number): ZoneVisual {
    let zv = this.zones.get(id);
    if (zv) return zv;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const flat = (geo: THREE.BufferGeometry, material: THREE.Material, scale: number, y: number) => {
      const m = new THREE.Mesh(geo, material);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(scale, scale, 1);
      m.position.y = y;
      return m;
    };
    const ringMat = glow(COLORS.extraction, 0.9, null, 2).clone();
    const innerMat = glow(COLORS.extraction, 0.5, null, 1.6).clone();
    const beaconMat = glow(0xff3b30, 1, null, 3).clone();
    const ring = flat(ringGeo, ringMat, r, 3);
    const inner = flat(ringGeo, innerMat, r * 0.72, 3.1);
    const disc = flat(discGeo, glow(COLORS.extraction, 0.12, Textures.radial(), 1), r, 2.8);
    const beam = new THREE.Mesh(beamGeo, glow(COLORS.extraction, 0.2, Textures.beam(), 1.3));
    beam.scale.set(r * 0.98, 320, r * 0.98);
    beam.position.y = 160;
    // Two landing floodlights + beacon masts at the pad edge.
    const flood: THREE.Mesh[] = [];
    for (const a of [Math.PI * 0.25, Math.PI * 1.25]) {
      const px = Math.cos(a) * (r + 18);
      const pz = Math.sin(a) * (r + 18);
      const pool = new THREE.Mesh(quadGeo, decalMat('additive', Decals.lightPool(), COLORS.extraction, 0.3));
      pool.scale.set(r * 1.4, 1, r * 1.4);
      pool.position.set(px * 0.55, 2.6, pz * 0.55);
      flood.push(pool);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.6, 70, 6), new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.6 }));
      mast.position.set(px, 35, pz);
      mast.castShadow = true;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), beaconMat);
      lamp.position.set(px, 72, pz);
      group.add(mast, lamp, pool);
    }
    group.add(ring, inner, disc, beam);
    this.root.add(group);
    zv = { group, ring, inner, disc, beam, flood, ringMat, innerMat, beaconMat, nextMote: 0 };
    this.zones.set(id, zv);
    return zv;
  }

  private updateGlobal(client: GameClient, g: MatchGlobalState | null, time: number): void {
    if (!g) return;
    const pulse = 0.5 + 0.5 * Math.sin(time / 260);

    for (const z of g.extractionZones) {
      const zv = this.zoneVisual(z.id, z.position.x, z.position.y, z.radius);
      const busy = z.playersCurrentlyExtracting.length > 0;
      const color = busy ? COLORS.supply : COLORS.extraction;
      zv.beam.visible = z.active;
      zv.disc.visible = z.active;
      zv.inner.visible = z.active;
      for (const f of zv.flood) f.visible = z.active;
      if (z.active) tint(zv.ringMat, color, 2 + pulse, 0.9);
      else tint(zv.ringMat, 0x9ca3af, 1, 0.22);
      zv.ring.scale.setScalar(z.radius * (z.active ? 1 + pulse * 0.02 : 1));
      if (z.active) {
        zv.inner.rotation.z = time / 1800;
        tint(zv.innerMat, color, 1.6, 0.35 + pulse * 0.25);
        if (time >= zv.nextMote) {
          zv.nextMote = time + 70;
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * z.radius * 0.95;
          this.glowPool.spawn({ x: z.position.x + Math.cos(a) * rr, y: 6, z: z.position.y + Math.sin(a) * rr, vy: rnd(60, 120), color, intensity: 2, size: 3.5, endSize: 1, life: rnd(1800, 2800) });
        }
      }
      // Beacons blink red while inactive, green once open.
      const blink = Math.sin(time / 180 + z.position.x) > 0.3;
      tint(zv.beaconMat, z.active ? color : 0xff3b30, z.active || blink ? 3 : 0.4, 1);
    }

    // Bounty markers (approximate positions).
    this.markerRings(this.bountyRings, g.bounties, COLORS.danger, pulse);
    this.markerRings(this.kingpinRings, g.kingpins ?? [], 0xf5c542, pulse);

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
        this.crateOpen(d.x, d.y, COLORS.supply, true);
        this.deathBurst(d.x, d.y);
      }
      v.marker.visible = !d.opened;
      v.beam.visible = !d.landed;
      v.marker.scale.setScalar(60 + (1 - pulse) * 30);
    }
  }

  private markerRings(pool: THREE.Mesh[], markers: readonly { x: number; y: number; radius: number }[], color: number, pulse: number): void {
    while (pool.length < markers.length) {
      const m = new THREE.Mesh(ringGeo, glow(color, 0.8, null, 2).clone());
      m.rotation.x = -Math.PI / 2;
      m.position.y = 3.2;
      this.root.add(m);
      pool.push(m);
    }
    pool.forEach((m, i) => {
      const b = markers[i];
      m.visible = !!b;
      if (b) {
        m.position.x = b.x;
        m.position.z = b.y;
        m.scale.set(b.radius, b.radius, 1);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.4 * pulse;
      }
    });
  }

  dispose(): void {
    this.root.removeFromParent();
    (this.tracers.material as THREE.Material).dispose();
    this.glowPool.dispose();
    this.smokePool.dispose();
  }
}
