import type { RectObstacle } from '@extract/game-types';
import * as THREE from 'three';
import { Batcher, box, cylinder, floorQuad, worldUV } from './geometry';
import { decalMat, glow, mat, surface } from './materials';
import { HEIGHT } from './style';
import { Decals, Textures, stencilTexture } from './textures';

/**
 * Procedural models for every rectangular obstacle style. Models are built in
 * a local frame (long axis = +X, centred on the obstacle) and pushed into
 * shared batchers, so hundreds of props cost only a few draw calls.
 */

const CONTAINER_PAINT = [0x8a3a2c, 0x2b4d78, 0x3d6a45, 0xb0722a, 0x5b6068, 0x1f5c5e];
const CONTAINER_NAMES = ['MERIDIAN', 'KESTREL LINES', 'HALCYON', 'NORTHWIND', 'ORCA FREIGHT', 'TAKEDA'];
const BARREL_PAINT = [0x2b4f8c, 0x8f2a24, 0x4b5a2c, 0xc9a227, 0x3b3f45];
const CAR_PAINT = [0x6b7078, 0x6e2a26, 0x2f4a6b, 0xb9b4a6, 0x3f4a3a, 0x8a6a2c];

export interface PropBatches {
  /** Opaque, casts + receives shadows. */
  solid: Batcher;
  /** Unlit emissive bits (lamps, screens). */
  glow: Batcher;
  /** Floor decals drawn right under props (hazard paint, stencils). */
  paint: Batcher;
}

/** Local model frame for one obstacle: long side along local +X. */
class Frame {
  readonly cx: number;
  readonly cy: number;
  readonly len: number;
  readonly depth: number;
  readonly angle: number;

  constructor(o: RectObstacle) {
    this.cx = o.x + o.w / 2;
    this.cy = o.y + o.h / 2;
    const along = o.w >= o.h;
    this.len = along ? o.w : o.h;
    this.depth = along ? o.h : o.w;
    this.angle = along ? 0 : Math.PI / 2;
  }

  /** Places a local geometry (built around the origin) into the world. */
  place(g: THREE.BufferGeometry): THREE.BufferGeometry {
    g.rotateY(-this.angle);
    g.translate(this.cx, 0, this.cy);
    return g;
  }

  /** Centre-based local box: (x, z) centre, sizes along X/Z, from `base` up by `h`. */
  box(x: number, z: number, w: number, d: number, h: number, base = 0): THREE.BufferGeometry {
    return this.place(box(x - w / 2, z - d / 2, w, d, h, base));
  }

  cyl(x: number, z: number, r: number, h: number, base = 0, seg = 12, rTop = r): THREE.BufferGeometry {
    return this.place(cylinder(x, z, r, h, base, seg, rTop));
  }

  /** Cylinder lying along local Z (wheels). */
  wheel(x: number, z: number, r: number, width: number, y: number): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(r, r, width, 14);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    return this.place(g);
  }

  /** Flattened sphere (sand bags, sacks). */
  blob(x: number, z: number, y: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
    const g = new THREE.SphereGeometry(1, 8, 5);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return this.place(g);
  }

  decal(x: number, z: number, w: number, d: number, height: number): THREE.BufferGeometry {
    const g = floorQuad(0, 0, w, d, height);
    g.translate(x, 0, z);
    return this.place(g);
  }
}

export class PropKit {
  private readonly m = {
    concrete: surface(0xa9a8a1, Textures.slab(), { rough: 0.95, normal: 1.4 }),
    darkMetal: mat(0x24272b, { rough: 0.45, metal: 0.7 }),
    frame: mat(0x2c2f33, { rough: 0.55, metal: 0.6 }),
    rubber: mat(0x141516, { rough: 0.9 }),
    glass: mat(0x0f151b, { rough: 0.08, metal: 0.7 }),
    wood: surface(0x8d6c47, Textures.crateWood(), { rough: 0.85, normal: 0.8 }),
    crate: surface(0xb59669, Textures.crateWood(), { rough: 0.8 }),
    cardboard: surface(0xffffff, Textures.cardboard(), { rough: 0.9 }),
    wrap: mat(0xaab3b8, { rough: 0.32, metal: 0.05 }),
    burlap: surface(0xc2ab82, Textures.burlap(), { rough: 1 }),
    sackDark: surface(0x8f7c58, Textures.burlap(), { rough: 1 }),
    rackUpright: mat(0xc9621d, { rough: 0.55, metal: 0.4 }),
    rackBeam: mat(0x2c5796, { rough: 0.5, metal: 0.4 }),
    deck: mat(0x6b7076, { rough: 0.6, metal: 0.5 }),
    genBody: surface(0xc79f2c, Textures.paintedMetal(), { rough: 0.55, metal: 0.3 }),
    genMil: surface(0x4a5a3a, Textures.paintedMetal(), { rough: 0.6, metal: 0.3 }),
    vent: mat(0x1b1d20, { rough: 0.7, metal: 0.5 }),
    machine: surface(0x56606a, Textures.paintedMetal(), { rough: 0.5, metal: 0.45 }),
    machineAccent: surface(0xc49a2a, Textures.paintedMetal(), { rough: 0.5, metal: 0.35 }),
    pipe: mat(0x8a8f96, { rough: 0.35, metal: 0.85 }),
    pump: surface(0xa3262c, Textures.paintedMetal(), { rough: 0.45, metal: 0.3 }),
    pumpTop: mat(0xe3e5e8, { rough: 0.45 }),
    vault: surface(0x4a4e55, Textures.treadPlate(), { rough: 0.45, metal: 0.65 }),
    vaultTrim: new THREE.MeshStandardMaterial({ color: 0x3d2e05, emissive: 0xf5b301, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.8 }),
    fence: surface(0x7c8288, Textures.corrugated(), { rough: 0.6, metal: 0.55 }),
    barbed: mat(0x3a3d41, { rough: 0.4, metal: 0.8 }),
    signYellow: mat(0xd8a820, { rough: 0.5 }),
    hazardPaint: decalMat('paint', Decals.hatch(), 0xffffff, 0.85),
  };

  private readonly containerPaint = CONTAINER_PAINT.map((c) => surface(c, Textures.corrugated(), { rough: 0.62, metal: 0.35, normal: 1.3 }));
  private readonly barrelPaint = BARREL_PAINT.map((c) => surface(c, Textures.paintedMetal(), { rough: 0.5, metal: 0.4 }));
  private readonly carPaint = CAR_PAINT.map((c) => surface(c, Textures.paintedMetal(), { rough: 0.4, metal: 0.45 }));
  private readonly charred = surface(0x2a2826, Textures.paintedMetal(), { rough: 0.9, metal: 0.2 });

  /** Emissive materials exposed so the renderer can animate them. */
  readonly vaultTrim = this.m.vaultTrim;

  constructor(
    private readonly b: PropBatches,
    private readonly rand: () => number,
  ) {}

  private pick<T>(list: readonly T[], id: number): T {
    return list[Math.abs(id) % list.length]!;
  }

  add(o: RectObstacle): boolean {
    const f = new Frame(o);
    switch (o.style) {
      case 'container':
        this.container(f, o);
        return true;
      case 'machine':
        this.machine(f, o);
        return true;
      case 'pump':
        this.pump(f);
        return true;
      case 'vault':
        this.vaultPillar(f);
        return true;
      case 'crate_stack':
        this.crateStack(f, o);
        return true;
      case 'barrier':
        this.barrier(f);
        return true;
      case 'barrel':
        this.barrels(f, o);
        return true;
      case 'pallet':
        this.pallet(f, o);
        return true;
      case 'shelf':
        this.shelf(f);
        return true;
      case 'generator':
        this.generator(f, o);
        return true;
      case 'vehicle':
        this.vehicle(f, o);
        return true;
      case 'sandbag':
        this.sandbags(f);
        return true;
      case 'fence':
        this.fence(f);
        return true;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- models

  private container(f: Frame, o: RectObstacle): void {
    const { solid, paint } = this.b;
    const L = f.len;
    const D = f.depth;
    const H = HEIGHT.container;
    const levels = o.id % 3 === 0 ? 2 : 1;
    for (let lvl = 0; lvl < levels; lvl++) {
      const tint = this.containerPaint[((o.tint ?? 0) + lvl * 2) % this.containerPaint.length]!;
      const base = lvl * H;
      const inset = lvl === 1 ? 2 : 0;
      solid.add(tint, worldUV(f.box(0, 0, L - 2 - inset, D - 2 - inset, H - 2, base + 1), 64));
      // Frame: corner posts + top/bottom rails.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) solid.add(this.m.frame, f.box(sx * (L / 2 - 2 - inset / 2), sz * (D / 2 - 2 - inset / 2), 4, 4, H, base));
      }
      for (const sz of [-1, 1]) {
        solid.add(this.m.frame, f.box(0, sz * (D / 2 - 1.5 - inset / 2), L - inset, 3, 3, base + H - 3));
        solid.add(this.m.frame, f.box(0, sz * (D / 2 - 1.5 - inset / 2), L - inset, 3, 3, base));
      }
      // Door end: two leaves with locking bars.
      const endX = L / 2 - inset / 2;
      solid.add(tint, f.box(endX - 0.6, 0, 1.6, D - 6, H - 8, base + 4));
      for (const bz of [-D / 3, -D / 8, D / 8, D / 3]) solid.add(this.m.pipe, f.cyl(endX + 0.6, bz, 0.8, H - 10, base + 5, 6));
      if (lvl === levels - 1 && this.rand() < 0.75) {
        const name = this.pick(CONTAINER_NAMES, o.id + lvl);
        paint.add(decalMat('paint', stencilTexture(name), 0xe8e6de, 0.55), f.decal(-L * 0.08, 0, Math.min(L * 0.62, 96), D * 0.42, base + H + 0.25));
      }
    }
  }

  private machine(f: Frame, o: RectObstacle): void {
    const { solid, glow: glows, paint } = this.b;
    const L = f.len;
    const D = f.depth;
    const H = HEIGHT.machine;
    solid.add(this.m.darkMetal, f.box(0, 0, L, D, 5));
    solid.add(this.m.machine, worldUV(f.box(-L * 0.12, 0, L * 0.72, D - 8, H - 10, 5), 48));
    solid.add(this.m.machineAccent, worldUV(f.box(L * 0.33, 0, L * 0.26, D * 0.7, H, 5), 48));
    // Pipes along the back.
    solid.add(this.m.pipe, f.place(new THREE.CylinderGeometry(2.4, 2.4, L * 0.7, 8).rotateZ(Math.PI / 2).translate(-L * 0.12, H - 14, -D / 2 + 5)));
    solid.add(this.m.pipe, f.cyl(-L * 0.4, -D / 2 + 5, 2.4, H - 10, 5, 8));
    // Control panel + screen facing +Z.
    solid.add(this.m.darkMetal, f.box(-L * 0.12, D / 2 - 5, 18, 6, 14, H - 22));
    glows.add(glow(o.id % 2 === 0 ? 0x38d6e8 : 0x4ade80, 1, null, 2.2), f.box(-L * 0.12, D / 2 - 1.8, 12, 0.6, 7, H - 18));
    glows.add(glow(o.id % 2 === 0 ? 0x4ade80 : 0xf59e0b, 1, null, 3), f.box(L * 0.33, D * 0.18, 5, 5, 3, H + 5));
    // Hazard stripes painted around the base.
    for (const sz of [-1, 1]) paint.add(this.m.hazardPaint, f.decal(0, sz * (D / 2 + 7), L + 10, 8, 1.9));
  }

  private pump(f: Frame): void {
    const { solid, glow: glows } = this.b;
    const L = f.len;
    const D = f.depth;
    const H = HEIGHT.pump;
    solid.add(this.m.concrete, worldUV(f.box(0, 0, L + 10, D + 10, 4), 64));
    solid.add(this.m.pump, worldUV(f.box(0, 0, L - 4, D - 4, H - 6, 4), 32));
    solid.add(this.m.pumpTop, f.box(0, 0, L, D, 5, H - 2));
    glows.add(glow(0x9fe8ff, 1, null, 1.6), f.box(L * 0.15, D / 2 - 1.6, L * 0.4, 0.6, 7, H - 16));
  }

  private vaultPillar(f: Frame): void {
    const { solid, glow: glows } = this.b;
    const L = f.len;
    const D = f.depth;
    const H = HEIGHT.vault + 20;
    solid.add(this.m.vault, worldUV(f.box(0, 0, L, D, H), 48));
    solid.add(this.m.vaultTrim, f.box(0, 0, L + 4, D + 4, 6, HEIGHT.vault));
    solid.add(this.m.vaultTrim, f.box(0, 0, L + 2, D + 2, 3, 0));
    glows.add(glow(0xf5c542, 1, null, 2.4), f.box(0, 0, L * 0.5, D * 0.5, 2, H));
  }

  private crateStack(f: Frame, o: RectObstacle): void {
    const s = f.len;
    const g = new THREE.BoxGeometry(s - 2, 26, s - 2);
    g.rotateY((o.id % 7) * 0.05);
    g.translate(0, 13, 0);
    this.b.solid.add(this.m.crate, f.place(g));
    const t = new THREE.BoxGeometry(s - 14, 20, s - 16);
    t.rotateY(0.35 + (o.id % 5) * 0.1);
    t.translate(2, 36, -1);
    this.b.solid.add(this.m.crate, f.place(t));
  }

  private barrier(f: Frame): void {
    const L = f.len;
    const segs = L > 60 ? 2 : 1;
    const segL = (L - (segs - 1) * 2) / segs;
    const shape = new THREE.Shape([
      new THREE.Vector2(-f.depth / 2, 0),
      new THREE.Vector2(f.depth / 2, 0),
      new THREE.Vector2(f.depth / 2, 3),
      new THREE.Vector2(f.depth * 0.3, 10),
      new THREE.Vector2(f.depth * 0.2, HEIGHT.barrier),
      new THREE.Vector2(-f.depth * 0.2, HEIGHT.barrier),
      new THREE.Vector2(-f.depth * 0.3, 10),
      new THREE.Vector2(-f.depth / 2, 3),
    ]);
    for (let i = 0; i < segs; i++) {
      const g = new THREE.ExtrudeGeometry(shape, { depth: segL, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      g.translate(-L / 2 + i * (segL + 2), 0, 0);
      this.b.solid.add(this.m.concrete, worldUV(f.place(g), 48));
      // Reflective band.
      this.b.solid.add(this.m.signYellow, f.box(-L / 2 + i * (segL + 2) + segL / 2, 0, segL * 0.6, f.depth * 0.42, 2.2, HEIGHT.barrier - 3));
    }
  }

  private barrels(f: Frame, o: RectObstacle): void {
    const r = 8.6;
    const spots: [number, number][] = [
      [-8.5, -8],
      [8.5, -8],
      [0, 8],
    ];
    spots.forEach(([x, z], i) => {
      if (i === 2 && o.id % 4 === 0) return; // some groups are pairs
      const paint = this.pick(this.barrelPaint, o.id * 3 + i);
      const h = HEIGHT.barrel;
      this.b.solid.add(paint, worldUV(f.cyl(x, z, r, h, 0, 14), 40));
      for (const y of [h * 0.33, h * 0.66]) this.b.solid.add(this.m.darkMetal, f.cyl(x, z, r + 0.5, 1.4, y, 14));
      this.b.solid.add(this.m.darkMetal, f.cyl(x, z, r + 0.3, 1.2, h - 1, 14));
      this.b.solid.add(this.m.darkMetal, f.cyl(x + 3.5, z - 2.5, 1.4, 1.6, h, 6));
    });
  }

  private pallet(f: Frame, o: RectObstacle): void {
    const s = Math.min(f.len, f.depth);
    const { solid } = this.b;
    // Pallet: three runners + top boards.
    for (const z of [-s / 2 + 4, 0, s / 2 - 4]) solid.add(this.m.wood, f.box(0, z, s - 2, 5, 5));
    for (let k = 0; k < 5; k++) solid.add(this.m.wood, f.box(-s / 2 + 5 + k * ((s - 10) / 4), 0, 7, s - 2, 2.5, 5));
    const variant = o.id % 3;
    const top = 7.5;
    if (variant === 0) {
      // Shrink-wrapped block with straps.
      const h = 22 + (o.id % 5) * 3;
      solid.add(this.m.wrap, f.box(0, 0, s - 6, s - 6, h, top));
      for (const x of [-s / 4, s / 4]) solid.add(this.m.rubber, f.box(x, 0, 2, s - 5, h + 0.6, top));
    } else if (variant === 1) {
      // Stacked cartons.
      const n = 2 + (o.id % 3);
      for (let i = 0; i < n; i++) {
        const w = 16 + ((o.id + i) % 3) * 3;
        const x = (i % 2 ? 1 : -1) * (s / 4 - 1);
        const z = (i < 2 ? -1 : 1) * (s / 4 - 1);
        const g = new THREE.BoxGeometry(w, 14, w);
        g.rotateY((i * 0.4 + o.id * 0.13) % 0.5);
        g.translate(x, top + 7 + (i >= 4 ? 14 : 0), z);
        solid.add(this.m.cardboard, f.place(g));
      }
      solid.add(this.m.cardboard, f.box(0, 0, s * 0.45, s * 0.45, 12, top + 14));
    } else {
      // Sacks.
      for (let i = 0; i < 6; i++) {
        const x = ((i % 3) - 1) * 13;
        const z = i < 3 ? -8 : 8;
        solid.add(i % 2 ? this.m.burlap : this.m.sackDark, f.blob(x, z, top + 5 + (i % 2) * 2, 9, 5, 7));
      }
      solid.add(this.m.burlap, f.blob(0, 0, top + 13, 10, 5, 8));
    }
  }

  private shelf(f: Frame): void {
    const L = f.len;
    const D = f.depth;
    const H = HEIGHT.shelf;
    const { solid } = this.b;
    const posts = Math.max(2, Math.round(L / 50) + 1);
    for (let i = 0; i < posts; i++) {
      const x = -L / 2 + 2 + (i * (L - 4)) / (posts - 1);
      for (const sz of [-1, 1]) solid.add(this.m.rackUpright, f.box(x, sz * (D / 2 - 1.5), 3, 3, H));
    }
    for (const y of [3, 32, H - 6]) {
      for (const sz of [-1, 1]) solid.add(this.m.rackBeam, f.box(0, sz * (D / 2 - 1.5), L, 2.5, 3.5, y));
      solid.add(this.m.deck, f.box(0, 0, L - 2, D - 4, 1.2, y + 1));
    }
    // Stock on the decks (cartons + cases), gaps in between.
    let seed = Math.round(f.cx * 7 + f.cy * 13);
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed % 1000) / 1000;
    };
    for (const y of [4.5, 33.5, H - 4.5]) {
      let x = -L / 2 + 4;
      while (x < L / 2 - 12) {
        const w = 12 + next() * 18;
        if (next() > 0.2 && x + w < L / 2 - 3) {
          const h = y > H - 10 ? 8 + next() * 6 : 12 + next() * 12;
          solid.add(next() > 0.3 ? this.m.cardboard : this.m.crate, f.box(x + w / 2, 0, w - 2, D - 8, h, y));
        }
        x += w;
      }
    }
  }

  private generator(f: Frame, o: RectObstacle): void {
    const L = f.len;
    const D = f.depth;
    const H = HEIGHT.generator;
    const { solid, glow: glows, paint } = this.b;
    const body = o.id % 2 === 0 ? this.m.genBody : this.m.genMil;
    solid.add(this.m.darkMetal, f.box(0, 0, L, D, 4));
    solid.add(body, worldUV(f.box(-2, 0, L - 10, D - 6, H - 8, 4), 40));
    for (let i = 0; i < 5; i++) solid.add(this.m.vent, f.box(-L / 2 + 12 + i * 7, D / 2 - 2.6, 4, 0.8, H - 18, 10));
    solid.add(this.m.pipe, f.cyl(L * 0.28, -D * 0.18, 2.6, 12, H - 4, 8));
    solid.add(this.m.darkMetal, f.cyl(L * 0.28, -D * 0.18, 3.4, 1.5, H + 8, 8));
    solid.add(this.m.darkMetal, f.box(L / 2 - 5, 0, 6, D * 0.55, H * 0.6, 4));
    glows.add(glow(0x4ade80, 1, null, 3), f.box(L / 2 - 1.6, D * 0.12, 0.6, 3, 3, H * 0.45));
    glows.add(glow(0xf59e0b, 1, null, 3), f.box(L / 2 - 1.6, -D * 0.12, 0.6, 3, 3, H * 0.45));
    paint.add(this.m.hazardPaint, f.decal(0, 0, L + 16, D + 16, 1.85));
  }

  private vehicle(f: Frame, o: RectObstacle): void {
    const L = f.len;
    const D = f.depth;
    const { solid, glow: glows } = this.b;
    const burnt = o.id % 5 === 0;
    const paint = burnt ? this.charred : this.pick(this.carPaint, o.id);
    const kind = (o.tint ?? 0) % 3;
    const bodyH = 15;
    const base = 7;
    // Lower body + bumpers.
    solid.add(paint, worldUV(f.box(0, 0, L - 4, D - 4, bodyH, base), 48));
    for (const sx of [-1, 1]) solid.add(this.m.rubber, f.box(sx * (L / 2 - 2), 0, 4, D - 6, 6, base + 2));
    // Wheels.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid.add(this.m.rubber, f.wheel(sx * (L / 2 - 16), sz * (D / 2 - 4), 8, 7, 8));
    if (kind === 1) {
      // Van: tall box body, short hood at +X.
      solid.add(paint, worldUV(f.box(-8, 0, L - 26, D - 6, 24, base + bodyH), 48));
      solid.add(this.m.glass, f.box(L / 2 - 30, 0, 6, D - 8, 12, base + bodyH + 6));
      solid.add(this.m.darkMetal, f.box(-12, 0, L - 40, D - 14, 2, base + bodyH + 24));
    } else if (kind === 2) {
      // Pickup: cab in the middle-front, open bed at the back.
      solid.add(this.m.glass, f.box(8, 0, 30, D - 8, 12, base + bodyH));
      solid.add(paint, f.box(8, 0, 26, D - 10, 2.5, base + bodyH + 12));
      for (const sz of [-1, 1]) solid.add(paint, f.box(-L / 4 - 4, sz * (D / 2 - 3), L / 2 - 14, 2.5, 8, base + bodyH));
      solid.add(paint, f.box(-L / 2 + 4, 0, 2.5, D - 6, 8, base + bodyH));
      solid.add(this.m.crate, f.box(-L / 4 - 2, 0, 16, 16, 12, base + bodyH - 2));
    } else {
      // Sedan: cabin with glass all round, roof.
      solid.add(this.m.glass, f.box(-4, 0, 44, D - 8, 12, base + bodyH));
      solid.add(paint, f.box(-6, 0, 36, D - 10, 2.5, base + bodyH + 12));
    }
    if (!burnt) {
      for (const sz of [-1, 1]) {
        glows.add(glow(0xfff1c4, 0.9, null, 1.2), f.box(L / 2 - 1.2, sz * (D / 2 - 7), 0.6, 6, 3, base + 8));
        glows.add(glow(0xff3b30, 0.9, null, 1.6), f.box(-L / 2 + 1.2, sz * (D / 2 - 7), 0.6, 6, 3, base + 9));
      }
    }
  }

  private sandbags(f: Frame): void {
    const L = f.len;
    const n = Math.max(3, Math.round(L / 12));
    const step = L / n;
    for (let layer = 0; layer < 3; layer++) {
      const rows = layer === 2 ? [0] : [-4.5, 4.5];
      const offset = layer % 2 ? step / 2 : 0;
      for (const z of rows) {
        for (let i = 0; i < n - (layer % 2); i++) {
          const x = -L / 2 + step / 2 + i * step + offset;
          this.b.solid.add(i % 3 === 0 ? this.m.sackDark : this.m.burlap, f.blob(x, z, 4.5 + layer * 8, step * 0.56, 4.6, 5.4));
        }
      }
    }
  }

  private fence(f: Frame): void {
    const L = f.len;
    const H = HEIGHT.fence;
    const { solid } = this.b;
    const posts = Math.max(2, Math.round(L / 45) + 1);
    for (let i = 0; i < posts; i++) solid.add(this.m.barbed, f.box(-L / 2 + 2 + (i * (L - 4)) / (posts - 1), 0, 4, 4, H + 4));
    solid.add(this.m.fence, worldUV(f.box(0, 0, L - 4, 2, H - 8, 4), 48));
    for (const y of [H + 1, H + 5]) solid.add(this.m.barbed, f.box(0, 0, L, 0.8, 0.8, y));
    solid.add(this.m.signYellow, f.box(L * 0.2, 1.6, 16, 0.6, 11, H * 0.5));
  }
}
