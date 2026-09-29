import { MATCH_CONFIG, PLAYER_CONFIG, WEAPONS, weaponFromIndex } from '@extract/game-config';
import type { ImpactType, MatchGlobalState, MuzzleFlashType, ObstacleStyle, TracerType, WeaponDefinition } from '@extract/game-types';
import * as THREE from 'three';
import type { ImpactSurface } from '../audio/SoundEngine';
import type { ClientBullet, GameClient } from '../net/GameClient';
import { CasingPool } from './Casings';
import { decalMat, glow } from './materials';
import { createFallingDrop } from './models/CrateModel';
import { ParticlePool } from './Particles';
import { COLORS, GUN_HEIGHT } from './style';
import { Decals, Textures } from './textures';

const MAX_TRACERS = 700;
const MAX_LINGER = 48;
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

const SURFACE_SOUND: Record<Surface, ImpactSurface> = {
  concrete: 'concrete',
  rock: 'concrete',
  metal: 'metal',
  wood: 'wood',
  sand: 'soft',
  foliage: 'soft',
};

/** Tracer look per family. `faint` scales non-tracer rounds (tracerEvery > 1). */
const TRACER: Record<TracerType, { len: number; width: number; intensity: number; faint: number; linger: number }> = {
  light: { len: 52, width: 2, intensity: 2.6, faint: 0.3, linger: 0 },
  standard: { len: 74, width: 2.6, intensity: 3.2, faint: 0.26, linger: 0 },
  pellet: { len: 30, width: 1.7, intensity: 2.5, faint: 1, linger: 0 },
  heavy: { len: 96, width: 3.3, intensity: 3.8, faint: 0.3, linger: 0 },
  sniper: { len: 230, width: 4.2, intensity: 4.6, faint: 1, linger: 280 },
  void: { len: 140, width: 3.8, intensity: 5, faint: 1, linger: 220 },
};

/** Impact size per weapon family. */
const IMPACT_SCALE: Record<ImpactType, number> = { light: 0.7, standard: 1, pellet: 0.45, heavy: 1.5, void: 1 };

/** Muzzle smoke / spark amount per flash family. */
const MUZZLE_FX: Record<MuzzleFlashType, { smoke: number; sparks: number }> = {
  pistol: { smoke: 0.5, sparks: 2 },
  magnum: { smoke: 1, sparks: 4 },
  smg: { smoke: 0.35, sparks: 1 },
  suppressed: { smoke: 0.25, sparks: 0 },
  rifle: { smoke: 0.6, sparks: 2 },
  battle: { smoke: 1, sparks: 4 },
  shotgun: { smoke: 1.4, sparks: 7 },
  sniper: { smoke: 1.3, sparks: 5 },
  lmg: { smoke: 0.7, sparks: 2 },
  void: { smoke: 0, sparks: 5 },
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

interface Linger {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  color: number;
  width: number;
  intensity: number;
  born: number;
  life: number;
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

export interface EffectsHooks {
  /** A remote player's shot appeared (pellets of one shot are reported once). */
  onRemoteShot(ownerId: number, def: WeaponDefinition, x: number, y: number, angle: number): void;
  /** A round hit the world (for impact sounds near the listener). */
  onImpact(surface: ImpactSurface, x: number, y: number): void;
  /** An enemy round passed close to the local player. */
  onWhiz(x: number, y: number): void;
}

/** All transient / dynamic visuals that are not tied to a single entity. */
export class Effects {
  readonly root = new THREE.Group();
  /** Glowing particles (sparks, flashes, motes). */
  readonly glowPool: ParticlePool;
  /** Alpha-blended particles (smoke, dust, debris, blood). */
  readonly smokePool: ParticlePool;
  readonly casings = new CasingPool();
  private readonly tracers: THREE.InstancedMesh;
  private readonly lingerMesh: THREE.InstancedMesh;
  private readonly lingers: Linger[] = [];
  private readonly seenBullets = new Set<number>();
  /** Bullet id -> distance along its path where it passes the local player (near miss). */
  private readonly whizAt = new Map<number, number>();
  private readonly lastRemoteShot = new Map<number, number>();
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

  constructor(private readonly hooks: EffectsHooks) {
    const tracerMat = () =>
      new THREE.MeshBasicMaterial({ map: Textures.tracer(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.tracers = new THREE.InstancedMesh(quadGeo, tracerMat(), MAX_TRACERS);
    this.lingerMesh = new THREE.InstancedMesh(quadGeo, new THREE.MeshBasicMaterial({ map: Textures.beam(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), MAX_LINGER);
    for (const m of [this.tracers, this.lingerMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = 10;
    }
    // Linger beams use a soft cross-section: rotate the vertical beam gradient sideways.
    (this.lingerMesh.material as THREE.MeshBasicMaterial).map = Textures.particle();
    this.glowPool = new ParticlePool(2600, Textures.particle(), 'additive');
    this.smokePool = new ParticlePool(1800, Textures.smoke(), 'normal', 0.12);
    this.root.add(this.tracers, this.lingerMesh, this.smokePool.mesh, this.glowPool.mesh, this.casings.mesh);
  }

  /** Particle budget for the current graphics quality (0..1). */
  setDensity(d: number): void {
    this.glowPool.density = d;
    this.smokePool.density = d;
    this.casings.density = Math.max(0.35, d);
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

  /** Muzzle smoke + sparks at a weapon's muzzle (world position), per weapon family. */
  muzzle(x: number, y: number, z: number, angle: number, def: WeaponDefinition): void {
    const fx = MUZZLE_FX[def.visual.muzzleFlash];
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const voidGun = def.visual.muzzleFlash === 'void';
    for (let i = 0; i < fx.sparks; i++) {
      const a = angle + rnd(-0.45, 0.45);
      const sp = rnd(260, 640);
      this.glowPool.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: rnd(-20, 70), vz: Math.sin(a) * sp, drag: 9, color: voidGun ? 0xc99bff : 0xffb454, intensity: 3.5, size: voidGun ? 2.6 : 2, life: rnd(80, 170), stretch: 0.05 });
    }
    if (fx.smoke > 0) {
      const n = fx.smoke >= 1 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const sp = rnd(30, 60) * fx.smoke;
        this.smokePool.spawn({ x: x + dx * 4, y, z: z + dz * 4, vx: dx * sp + rnd(-8, 8), vy: rnd(14, 26), vz: dz * sp + rnd(-8, 8), drag: 2.6, color: 0x9a968d, alpha: 0.16 + 0.14 * Math.min(1, fx.smoke), size: 7 * fx.smoke + 4, endSize: 26 * fx.smoke + 14, life: 500 + 450 * fx.smoke, rotation: rnd(0, 6), spin: rnd(-1, 1) });
      }
    }
    if (def.pelletCount > 1) {
      // Shotgun: a hot cone of burning powder.
      for (let i = 0; i < 6; i++) {
        const a = angle + rnd(-0.25, 0.25);
        const sp = rnd(300, 560);
        this.glowPool.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: rnd(-10, 30), vz: Math.sin(a) * sp, drag: 12, color: 0xff9a3c, intensity: 3, size: 5, endSize: 1, life: rnd(60, 120) });
      }
    }
  }

  /** Bullet hitting the world: reaction depends on the surface and the weapon. */
  impact(x: number, z: number, dirX: number, dirZ: number, surface: ObstacleStyle | null, type: ImpactType = 'standard'): void {
    const kind: Surface = surface ? SURFACE[surface] : 'concrete';
    const k = IMPACT_SCALE[type];
    const back = Math.atan2(-dirZ, -dirX);
    const burst = (n: number, speed: [number, number], spread: number, fn: (vx: number, vy: number, vz: number) => void) => {
      const count = Math.max(1, Math.round(n * k));
      for (let i = 0; i < count; i++) {
        const a = back + rnd(-spread, spread);
        const sp = rnd(speed[0], speed[1]);
        fn(Math.cos(a) * sp, rnd(40, 160), Math.sin(a) * sp);
      }
    };
    const y = GUN_HEIGHT;
    if (type === 'void') {
      this.glowPool.spawn({ x, y, z, color: 0xb57bff, intensity: 4.5, size: 24, endSize: 4, life: 140 });
      burst(9, [160, 380], 1.3, (vx, vy, vz) => this.glowPool.spawn({ x, y, z, vx, vy, vz, drag: 5, color: 0xd6b8ff, intensity: 3.6, size: 2.2, life: rnd(180, 320), stretch: 0.03 }));
      return;
    }
    switch (kind) {
      case 'metal':
        this.glowPool.spawn({ x, y, z, color: 0xfff1c4, intensity: 3.5, size: 16 * k, endSize: 4, life: 90 });
        burst(8, [180, 420], 1.1, (vx, vy, vz) =>
          this.glowPool.spawn({ x, y, z, vx, vy, vz, gravity: 520, drag: 2, color: 0xffb347, intensity: 3.2, size: 1.8, life: rnd(180, 380), stretch: 0.045 }),
        );
        this.smokePool.spawn({ x, y, z, vy: 18, drag: 2, color: 0x6e6a64, alpha: 0.25, size: 6 * k, endSize: 20 * k, life: 450 });
        break;
      case 'wood':
        burst(6, [90, 220], 0.9, (vx, vy, vz) =>
          this.smokePool.spawn({ x, y, z, vx, vy, vz, gravity: 600, drag: 1.5, color: 0x8b6a42, alpha: 0.95, size: 3.4, endSize: 2.4, life: rnd(350, 600), spin: rnd(-12, 12) }),
        );
        this.smokePool.spawn({ x, y, z, vx: Math.cos(back) * 30, vy: 20, vz: Math.sin(back) * 30, drag: 2.5, color: 0xa08560, alpha: 0.35, size: 8 * k, endSize: 26 * k, life: 600 });
        break;
      case 'sand':
        burst(10, [60, 180], 1.2, (vx, vy, vz) =>
          this.smokePool.spawn({ x, y, z, vx, vy, vz, gravity: 520, drag: 1.2, color: 0xb59c70, alpha: 0.9, size: 2, endSize: 1.5, life: rnd(300, 500) }),
        );
        this.smokePool.spawn({ x, y, z, vx: Math.cos(back) * 40, vy: 25, vz: Math.sin(back) * 40, drag: 2.5, color: 0xb8a27a, alpha: 0.45, size: 10 * k, endSize: 36 * k, life: 800 });
        break;
      case 'foliage':
        burst(6, [60, 160], 1.4, (vx, vy, vz) =>
          this.smokePool.spawn({ x, y: y + 20, z, vx, vy, vz, gravity: 160, drag: 2.5, color: 0x3e5a2c, alpha: 0.9, size: 3.2, life: rnd(600, 1000), spin: rnd(-8, 8) }),
        );
        break;
      default:
        // Concrete / rock: chips + a dusty puff + a couple of sparks.
        this.glowPool.spawn({ x, y, z, color: 0xfff1c4, intensity: 2.5, size: 10 * k, endSize: 3, life: 70 });
        burst(5, [120, 260], 1, (vx, vy, vz) =>
          this.smokePool.spawn({ x, y, z, vx, vy, vz, gravity: 620, drag: 1.2, color: 0x6d6b66, alpha: 1, size: 2.4, endSize: 2, life: rnd(300, 520) }),
        );
        burst(2, [200, 380], 0.8, (vx, vy, vz) =>
          this.glowPool.spawn({ x, y, z, vx, vy, vz, gravity: 520, drag: 2, color: 0xffc46b, intensity: 3, size: 1.6, life: 160, stretch: 0.04 }),
        );
        this.smokePool.spawn({ x, y, z, vx: Math.cos(back) * 34, vy: 22, vz: Math.sin(back) * 34, drag: 2.4, color: 0x9d988e, alpha: 0.42, size: 8 * k, endSize: 30 * k, life: 750 });
    }
  }

  /** A round that flew its full range: a small puff where it drops into the ground. */
  groundHit(x: number, z: number): void {
    this.smokePool.spawn({ x, y: 3, z, vy: 16, drag: 2.5, color: 0x7d766b, alpha: 0.3, size: 6, endSize: 18, life: 500 });
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

  /** Legendary moment: a ring shockwave of light + tall rising column of sparks. */
  legendaryBurst(x: number, z: number, color: number): void {
    this.lootBurst(x, z, color, 4);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      this.glowPool.spawn({ x, y: 6, z, vx: Math.cos(a) * 260, vy: 10, vz: Math.sin(a) * 260, drag: 3.5, color, intensity: 3.2, size: 5, endSize: 1, life: 520 });
    }
    for (let i = 0; i < 16; i++) {
      this.glowPool.spawn({ x: x + rnd(-6, 6), y: 10, z: z + rnd(-6, 6), vy: rnd(220, 420), drag: 1.2, color: 0xfff3c4, intensity: 3.5, size: 2.4, endSize: 0.5, life: rnd(700, 1100), stretch: 0.02 });
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

  /** Gentle glint rising from a valuable item lying on the ground. */
  mote(x: number, z: number, color: number): void {
    this.glowPool.spawn({ x: x + rnd(-10, 10), y: 8, z: z + rnd(-10, 10), vy: rnd(30, 60), color, intensity: 2.2, size: 2.6, endSize: 0.6, life: rnd(900, 1400) });
  }

  // ------------------------------------------------------------------ frame

  update(client: GameClient, dt: number, time: number): void {
    this.updateBullets(client);
    this.updateLingers();
    this.updateGlobal(client, client.global, time);
    const t = time / 1000;
    this.glowPool.update(t);
    this.smokePool.update(t);
    this.casings.update(dt);
  }

  /** Is the round ending at (x, z) on a character that still has armour? */
  private armorAt(client: GameClient, x: number, z: number): boolean {
    const r2 = (PLAYER_CONFIG.radius + 8) ** 2;
    for (const p of client.players.values()) if ((p.x - x) ** 2 + (p.y - z) ** 2 < r2) return p.armor > 0;
    const s = client.self;
    if (s && (client.renderX - x) ** 2 + (client.renderY - z) ** 2 < r2) return s.armor > 0;
    return false;
  }

  private onFirstSight(client: GameClient, b: ClientBullet, def: WeaponDefinition): void {
    const angle = Math.atan2(b.dy, b.dx);
    if (!b.local && !b.ghost) {
      // One muzzle effect / sound per shot, not per pellet.
      const last = this.lastRemoteShot.get(b.ownerId) ?? 0;
      if (b.born - last > 25) {
        this.lastRemoteShot.set(b.ownerId, b.born);
        this.hooks.onRemoteShot(b.ownerId, def, b.x0, b.y0, angle);
      }
      // Near miss: closest approach to the local player.
      if (client.canPredict) {
        const px = client.renderX - b.x0;
        const pz = client.renderY - b.y0;
        const along = px * b.dx + pz * b.dy;
        const perp = Math.abs(px * b.dy - pz * b.dx);
        if (along > 40 && along < b.maxDist && perp > PLAYER_CONFIG.radius && perp < 75) this.whizAt.set(b.id, along);
      }
    }
    // Sniper / void rounds leave a lingering beam along their whole path.
    const tracer = TRACER[def.visual.tracer];
    if (tracer.linger > 0 && !b.ghost) {
      const start = def.visual.muzzleDistance;
      const end = b.maxDist;
      if (this.lingers.length >= MAX_LINGER) this.lingers.shift();
      this.lingers.push({
        x0: b.x0 + b.dx * start,
        z0: b.y0 + b.dy * start,
        x1: b.x0 + b.dx * end,
        z1: b.y0 + b.dy * end,
        color: def.visual.tracerColor,
        width: tracer.width * 1.6,
        intensity: def.visual.tracer === 'void' ? 1.6 : 0.9,
        born: performance.now(),
        life: tracer.linger,
      });
      if (def.visual.tracer === 'sniper') {
        // Vapour trail.
        for (let d = start; d < end; d += 55) {
          this.smokePool.spawn({ x: b.x0 + b.dx * d, y: GUN_HEIGHT, z: b.y0 + b.dy * d, vy: rnd(3, 8), drag: 1, color: 0xc8ccd2, alpha: 0.11, size: 7, endSize: 20, life: rnd(900, 1400) });
        }
      }
    }
  }

  private updateBullets(client: GameClient): void {
    const now = performance.now();
    let n = 0;
    const bullets = client.bullets;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]!;
      const def = weaponFromIndex(b.weapon) ?? WEAPONS.basic_pistol;
      if (!this.seenBullets.has(b.id)) {
        this.seenBullets.add(b.id);
        this.onFirstSight(client, b, def);
      }
      const end = b.endDist ?? b.maxDist;
      const start = def.visual.muzzleDistance;
      const dist = ((now - b.born) / 1000) * b.speed + start;
      const whiz = this.whizAt.get(b.id);
      if (whiz !== undefined && dist >= whiz) {
        this.whizAt.delete(b.id);
        if (whiz < end) this.hooks.onWhiz(b.x0 + b.dx * whiz, b.y0 + b.dy * whiz);
      }
      if (dist >= end) {
        const hx = b.x0 + b.dx * end;
        const hz = b.y0 + b.dy * end;
        // Hits on players are only shown once the server confirms them (remote
        // bullets or the ghost copy of our own); predicted tracers just stop.
        if (b.hitPlayer && !b.local) this.playerHit(hx, hz, b.dx, b.dy, this.armorAt(client, hx, hz));
        else if (!b.ghost && !b.hitPlayer) {
          if (end < b.maxDist + 1 && b.surface) {
            this.impact(hx, hz, b.dx, b.dy, b.surface, def.visual.impact);
            this.hooks.onImpact(SURFACE_SOUND[SURFACE[b.surface]], hx, hz);
          } else if (end >= b.maxDist - 1 && !b.surface && def.pelletCount === 1) this.groundHit(hx, hz);
        }
        bullets.splice(i, 1);
        this.seenBullets.delete(b.id);
        this.whizAt.delete(b.id);
        continue;
      }
      if (n >= MAX_TRACERS || b.ghost) continue;
      const tr = TRACER[def.visual.tracer];
      const faint = b.tracer ? 1 : tr.faint;
      const head = Math.min(dist, end);
      const len = tr.len * (b.tracer ? 1 : 0.7);
      const tail = Math.max(start, head - len);
      if (head - tail < 1) continue;
      const mid = (head + tail) / 2;
      this.v.set(b.x0 + b.dx * mid, GUN_HEIGHT, b.y0 + b.dy * mid);
      this.q.setFromAxisAngle(this.up, -Math.atan2(b.dy, b.dx));
      this.s.set(head - tail, 1, tr.width * (b.tracer ? 1 : 0.6));
      this.m4.compose(this.v, this.q, this.s);
      this.tracers.setMatrixAt(n, this.m4);
      this.c.setHex(def.visual.tracerColor).multiplyScalar(tr.intensity * faint);
      this.tracers.setColorAt(n, this.c);
      n++;
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    if (this.seenBullets.size > 4000) this.seenBullets.clear();
  }

  private updateLingers(): void {
    const now = performance.now();
    let n = 0;
    for (let i = this.lingers.length - 1; i >= 0; i--) {
      const l = this.lingers[i]!;
      const t = (now - l.born) / l.life;
      if (t >= 1) {
        this.lingers.splice(i, 1);
        continue;
      }
      const dx = l.x1 - l.x0;
      const dz = l.z1 - l.z0;
      this.v.set((l.x0 + l.x1) / 2, GUN_HEIGHT, (l.z0 + l.z1) / 2);
      this.q.setFromAxisAngle(this.up, -Math.atan2(dz, dx));
      this.s.set(Math.hypot(dx, dz), 1, l.width * (1 + t * 1.5));
      this.m4.compose(this.v, this.q, this.s);
      this.lingerMesh.setMatrixAt(n, this.m4);
      this.c.setHex(l.color).multiplyScalar(l.intensity * (1 - t) * (1 - t));
      this.lingerMesh.setColorAt(n, this.c);
      n++;
    }
    this.lingerMesh.count = n;
    this.lingerMesh.instanceMatrix.needsUpdate = true;
    if (this.lingerMesh.instanceColor) this.lingerMesh.instanceColor.needsUpdate = true;
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
    (this.lingerMesh.material as THREE.Material).dispose();
    this.glowPool.dispose();
    this.smokePool.dispose();
    this.casings.dispose();
  }
}
