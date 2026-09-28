import type { MapData, RectObstacle } from '@extract/game-types';
import { CollisionWorld, pointInRect } from '@extract/shared';
import * as THREE from 'three';
import { Batcher, groundPlane, rng, tiledBox } from './geometry';
import { decalMat, glow, mat, surface, withProximityFade } from './materials';
import { PropKit } from './props';
import { COLORS, FLOOR_GROUND, HEIGHT, ZONE_GROUND, type GroundKind } from './style';
import { Decals, Textures, stencilTexture, type PbrTextures } from './textures';

const GROUND_TEX: Record<GroundKind, () => PbrTextures> = {
  field: Textures.field,
  forest: Textures.forestFloor,
  asphalt: Textures.asphalt,
  slab: Textures.slab,
  quay: Textures.quay,
  epoxy: Textures.epoxy,
  officeTiles: Textures.officeTiles,
  parquet: Textures.parquet,
  tread: Textures.treadPlate,
};

/** Decal layers (y offsets above the highest floor patch, drawn in this order). */
const Y = { shadow: 2.12, grime: 2.16, stain: 2.2, paint: 2.26, pad: 2.3, light: 2.4 };

export interface MapBuildOptions {
  /** Set dressing density: 'full' in game, 'lite' for the menu backdrop. */
  detail?: 'full' | 'lite';
}

export interface MapVisuals {
  root: THREE.Group;
  setVaultActive(active: boolean, time: number): void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ------------------------------------------------------------------ quads

/** Upward-facing quad from 4 map-space corners with explicit UVs. */
function quad(pts: [number, number][], uvs: [number, number][], height: number): THREE.BufferGeometry {
  const order = [0, 1, 2, 0, 2, 3];
  const pos = new Float32Array(18);
  const nor = new Float32Array(18);
  const uv = new Float32Array(12);
  order.forEach((k, i) => {
    pos.set([pts[k]![0], height, pts[k]![1]], i * 3);
    nor.set([0, 1, 0], i * 3);
    uv.set(uvs[k]!, i * 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Strip along segment A->B extending `width` along normal n; v=0 on the segment. */
function edgeStrip(ax: number, ay: number, bx: number, by: number, nx: number, ny: number, width: number, height: number, tile: number): THREE.BufferGeometry {
  const len = Math.hypot(bx - ax, by - ay);
  const u = len / tile;
  return quad(
    [
      [ax, ay],
      [bx, by],
      [bx + nx * width, by + ny * width],
      [ax + nx * width, ay + ny * width],
    ],
    [
      [0, 0],
      [u, 0],
      [u, 1],
      [0, 1],
    ],
    height,
  );
}

/** Paint line of `width` centred on segment A->B. */
function line(ax: number, ay: number, bx: number, by: number, width: number, height: number, tile = 256): THREE.BufferGeometry {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  return edgeStrip(ax - (nx * width) / 2, ay - (ny * width) / 2, bx - (nx * width) / 2, by - (ny * width) / 2, nx, ny, width, height, tile);
}

/** Axis-aligned decal rect with the whole texture (0..1). */
function rectDecal(x: number, y: number, w: number, h: number, height: number, rot = 0): THREE.BufferGeometry {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const corner = (dx: number, dy: number): [number, number] => [cx + dx * c - dy * s, cy + dx * s + dy * c];
  return quad([corner(-w / 2, h / 2), corner(w / 2, h / 2), corner(w / 2, -h / 2), corner(-w / 2, -h / 2)], [[0, 0], [1, 0], [1, 1], [0, 1]], height);
}

/** Soft contact shadow: 9-slice so the falloff has a constant world width `m`. */
function softRect(r: Rect, m: number, height: number): THREE.BufferGeometry {
  const xs = [r.x - m, r.x, r.x + r.w, r.x + r.w + m];
  const ys = [r.y - m, r.y, r.y + r.h, r.y + r.h + m];
  const ts = [0, 0.3, 0.7, 1];
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      parts.push(
        quad(
          [
            [xs[i]!, ys[j + 1]!],
            [xs[i + 1]!, ys[j + 1]!],
            [xs[i + 1]!, ys[j]!],
            [xs[i]!, ys[j]!],
          ],
          [
            [ts[i]!, ts[j + 1]!],
            [ts[i + 1]!, ts[j + 1]!],
            [ts[i + 1]!, ts[j]!],
            [ts[i]!, ts[j]!],
          ],
          height,
        ),
      );
    }
  }
  const merged = new THREE.BufferGeometry();
  const count = parts.reduce((n, p) => n + p.attributes.position!.count, 0);
  for (const name of ['position', 'normal', 'uv'] as const) {
    const size = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const p of parts) {
      arr.set(p.attributes[name]!.array as Float32Array, o);
      o += p.attributes[name]!.array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return merged;
}

// ------------------------------------------------------------------ build

export function buildMap(map: MapData, opts: MapBuildOptions = {}): MapVisuals {
  const full = opts.detail !== 'lite';
  const root = new THREE.Group();
  root.name = 'map';
  const rand = rng(map.width * 31 + map.obstacles.length * 7 + map.crates.length);
  const world = new CollisionWorld(map.obstacles, map.width, map.height);
  const interiors = map.floors.filter((f) => f.style === 'interior' || f.style === 'vault_floor');
  const zone = (type: string) => map.zones.find((z) => z.type === type);
  const inInterior = (x: number, y: number) => interiors.some((f) => pointInRect(x, y, f));
  const free = (x: number, y: number, r: number) => !world.circleIntersects(x, y, r);

  const solid = new Batcher();
  const glows = new Batcher();
  const shade = new Batcher();
  const paint = new Batcher();
  const wet = new Batcher();
  const lights = new Batcher();

  const shadowMat = decalMat('shade', Decals.softShadow(), 0x000000, 0.62);
  const grimeMat = decalMat('shade', Decals.grime(), 0x000000, 0.75);
  const oilMat = decalMat('shade', Decals.oil(), 0x000000, 0.42);
  const crackMat = decalMat('shade', Decals.cracks(), 0x000000, 0.8);
  const tireMat = decalMat('shade', Decals.tireMarks(), 0x000000, 0.55);
  const whitePaint = decalMat('paint', Decals.paint(), 0xe6e3d8, 0.8);
  const yellowPaint = decalMat('paint', Decals.paint(), 0xd9a91e, 0.85);
  const hatchPaint = decalMat('paint', Decals.hatch(), 0xffffff, 0.8);
  const arrowPaint = decalMat('paint', Decals.arrow(), 0xe6e3d8, 0.6);
  const manholeMat = decalMat('paint', Decals.manhole(), 0xffffff, 1);
  const drainMat = decalMat('paint', Decals.drain(), 0xffffff, 1);
  const puddleMat = decalMat('wet', Decals.puddle(), 0x7d8994, 0.42);
  const warmPool = decalMat('additive', Decals.lightPool(), COLORS.lamp, 0.34);
  const warmCone = decalMat('additive', Decals.lightCone(), COLORS.lamp, 0.42);
  const coolCone = decalMat('additive', Decals.lightCone(), COLORS.lampCool, 0.34);
  const goldPool = decalMat('additive', Decals.lightPool(), 0xf5c542, 0.3);
  const stencil = (text: string, opacity = 0.35, color = 0xe6e3d8) => decalMat('paint', stencilTexture(text), color, opacity);

  // --- Ground ------------------------------------------------------------------
  const pad = 2500;
  const outside = new THREE.Mesh(
    groundPlane(-pad, -pad, map.width + pad * 2, map.height + pad * 2, -0.5, 320),
    surface(0x55614c, Textures.field(), { rough: 1 }),
  );
  outside.receiveShadow = true;
  root.add(outside);
  // Water beyond the port corner.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(pad * 2, pad * 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0f2530, roughness: 0.12, metalness: 0.4 }),
  );
  water.position.set(map.width + pad * 0.5, 0.2, map.height + pad * 0.5);
  root.add(water);

  const floors = new Batcher();
  const groundMat = (kind: GroundKind, tint: number) =>
    surface(tint, GROUND_TEX[kind](), { rough: kind === 'tread' ? 0.55 : kind === 'epoxy' ? 0.62 : 0.95, metal: kind === 'tread' ? 0.4 : 0, normal: kind === 'asphalt' ? 0.8 : 1.1 });
  for (const z of map.zones) {
    const s = ZONE_GROUND[z.type];
    floors.add(groundMat(s.kind, s.tint), groundPlane(z.x, z.y, z.w, z.h, 0.4, s.tile));
  }
  const cityZone = zone('CITY');
  map.floors.forEach((f, i) => {
    let s = FLOOR_GROUND[f.style];
    // Building interiors: offices get tiles or parquet, halls keep the epoxy.
    if (f.style === 'interior' && cityZone && pointInRect(f.x + 1, f.y + 1, cityZone)) {
      s = { ...s, kind: i % 3 === 0 ? 'parquet' : 'officeTiles', tint: i % 3 === 0 ? 0xc9bba5 : 0xd6d4ce, tile: 128 };
    }
    floors.add(groundMat(s.kind, s.tint), groundPlane(f.x, f.y, f.w, f.h, s.y, s.tile));
  });
  floors.flush(root, { cast: false, receive: true });

  // --- Roads ---------------------------------------------------------------------
  const vault = zone('HIGH_VALUE');
  const onVault = (x: number, y: number) => !!vault && pointInRect(x, y, { x: vault.x - 20, y: vault.y - 20, w: vault.w + 40, h: vault.h + 40 });
  for (const f of map.floors) {
    if (f.style !== 'road') continue;
    const horizontal = f.w > f.h;
    const len = horizontal ? f.w : f.h;
    const along = (d: number, off: number): [number, number] => (horizontal ? [f.x + d, f.y + off] : [f.x + off, f.y + d]);
    const across = horizontal ? f.h : f.w;
    // Dashed centre line.
    for (let d = 30; d < len - 60; d += 120) {
      const [ax, ay] = along(d, across / 2);
      const [bx, by] = along(d + 60, across / 2);
      if (onVault(ax, ay) || onVault(bx, by)) continue;
      paint.add(whitePaint, line(ax, ay, bx, by, 5, Y.paint, 64));
    }
    // Edge lines + drains.
    for (const off of [10, across - 10]) {
      let start = 0;
      for (let d = 0; d <= len; d += 40) {
        const [x, y] = along(d, off);
        if (onVault(x, y) || d === len) {
          if (d - start > 40) {
            const [ax, ay] = along(start, off);
            const [bx, by] = along(d - 40, off);
            paint.add(whitePaint, line(ax, ay, bx, by, 4, Y.paint, 256));
          }
          start = d + 40;
        }
      }
      if (full) {
        for (let d = 200; d < len - 100; d += 420) {
          const [x, y] = along(d, off > across / 2 ? across - 2 : 2);
          if (!onVault(x, y)) paint.add(drainMat, rectDecal(x - (horizontal ? 18 : 5), y - (horizontal ? 5 : 18), horizontal ? 36 : 10, horizontal ? 10 : 36, Y.paint, 0));
        }
      }
    }
    // Zebra crossings.
    for (const d of [760, len - 760]) {
      for (let k = 12; k < across - 12; k += 20) {
        const [ax, ay] = along(d - 26, k);
        const [bx, by] = along(d + 26, k);
        paint.add(whitePaint, line(ax, ay, bx, by, 10, Y.paint, 128));
      }
    }
    if (full) {
      for (let i = 0; i < 10; i++) {
        const [x, y] = along(rand() * len, 20 + rand() * (across - 40));
        if (onVault(x, y) || !free(x, y, 30)) continue;
        const pick = rand();
        if (pick < 0.35) shade.add(crackMat, rectDecal(x - 60, y - 60, 120, 120, Y.stain, rand() * 6));
        else if (pick < 0.6) shade.add(tireMat, rectDecal(x - 90, y - 40, 180, 80, Y.stain, (horizontal ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.4));
        else if (pick < 0.8) paint.add(manholeMat, rectDecal(x - 16, y - 16, 32, 32, Y.paint));
        else wet.add(puddleMat, rectDecal(x - 50, y - 36, 100, 72, Y.stain, rand() * 3));
      }
    }
  }

  // --- Obstacles ---------------------------------------------------------------------
  const inVault = (o: RectObstacle) =>
    !!vault && o.x >= vault.x - 1 && o.y >= vault.y - 1 && o.x + o.w <= vault.x + vault.w + 1 && o.y + o.h <= vault.y + vault.h + 1;
  const isBorder = (o: RectObstacle) => o.x <= 0 || o.y <= 0 || o.x + o.w >= map.width || o.y + o.h >= map.height;

  const kit = new PropKit({ solid, glow: glows, paint }, rand);
  const wallMat = surface(COLORS.wall, Textures.wallPanel(), { rough: 0.92, normal: 1.2 });
  const wallBase = surface(COLORS.wallBase, Textures.slab(), { rough: 0.95 });
  const wallCap = mat(COLORS.wallCap, { rough: 0.5, metal: 0.55 });
  const borderMat = surface(COLORS.border, Textures.wallPanel(), { rough: 0.95, normal: 1.4 });
  const vaultWall = surface(0x3c4047, Textures.treadPlate(), { rough: 0.45, metal: 0.6 });
  const lampHousing = mat(0x1e2023, { rough: 0.5, metal: 0.6 });
  const lampGlow = glow(COLORS.lamp, 1, null, 3);
  const floodGlow = glow(COLORS.lampCool, 1, null, 3.2);

  const CONTACT: Partial<Record<RectObstacle['style'], number>> = {
    wall: 16,
    container: 26,
    machine: 18,
    pump: 12,
    vault: 22,
    crate_stack: 14,
    barrier: 12,
    barrel: 10,
    pallet: 12,
    shelf: 14,
    generator: 14,
    vehicle: 18,
    sandbag: 10,
    fence: 8,
  };

  let lampIndex = 0;
  for (const o of map.obstacles) {
    if (o.kind !== 'rect') continue;
    const m = CONTACT[o.style] ?? 12;
    if (!isBorder(o)) shade.add(shadowMat, softRect(o, m, Y.shadow));
    if (o.style !== 'wall') {
      if (!kit.add(o)) solid.add(wallMat, tiledBox(o.x, o.y, o.w, o.h, HEIGHT.wall, 0, 128));
      continue;
    }
    const horizontal = o.w >= o.h;
    if (isBorder(o)) {
      solid.add(borderMat, tiledBox(o.x, o.y, o.w, o.h, HEIGHT.border, 0, 160));
      solid.add(wallCap, tiledBox(o.x - 2, o.y - 2, o.w + 4, o.h + 4, 4, HEIGHT.border, 64));
      // Inward floodlights along the perimeter.
      const len = horizontal ? o.w : o.h;
      for (let d = 300; d < len - 200; d += 620) {
        const inward = horizontal ? (o.y <= 0 ? 1 : -1) : o.x <= 0 ? 1 : -1;
        const fx = horizontal ? o.x + d : inward > 0 ? o.x + o.w : o.x;
        const fy = horizontal ? (inward > 0 ? o.y + o.h : o.y) : o.y + d;
        const nx = horizontal ? 0 : inward;
        const ny = horizontal ? inward : 0;
        glows.add(floodGlow, tiledBox(fx - 6 + nx * 3, fy - 6 + ny * 3, 12, 12, 4, HEIGHT.border - 16, 16));
        lights.add(coolCone, edgeStrip(fx - ny * 90, fy - nx * 90, fx + ny * 90, fy + nx * 90, nx, ny, 260, Y.light, 1));
      }
      continue;
    }
    if (inVault(o)) {
      solid.add(vaultWall, tiledBox(o.x, o.y, o.w, o.h, HEIGHT.vault, 0, 64));
      solid.add(kit.vaultTrim, tiledBox(o.x - 1, o.y - 1, o.w + 2, o.h + 2, 5, HEIGHT.vault, 64));
      continue;
    }
    solid.add(wallMat, tiledBox(o.x, o.y, o.w, o.h, HEIGHT.wall, 0, 128));
    solid.add(wallBase, tiledBox(o.x - 1, o.y - 1, o.w + 2, o.h + 2, 8, 0, 64));
    solid.add(wallCap, tiledBox(o.x - 1.5, o.y - 1.5, o.w + 3, o.h + 3, 3.5, HEIGHT.wall, 64));
    // Grime along both faces.
    if (horizontal) {
      shade.add(grimeMat, edgeStrip(o.x, o.y, o.x + o.w, o.y, 0, -1, 22, Y.grime, 64));
      shade.add(grimeMat, edgeStrip(o.x, o.y + o.h, o.x + o.w, o.y + o.h, 0, 1, 22, Y.grime, 64));
    } else {
      shade.add(grimeMat, edgeStrip(o.x, o.y, o.x, o.y + o.h, -1, 0, 22, Y.grime, 64));
      shade.add(grimeMat, edgeStrip(o.x + o.w, o.y, o.x + o.w, o.y + o.h, 1, 0, 22, Y.grime, 64));
    }
    // Wall lamps with a warm cone on the floor.
    const len = horizontal ? o.w : o.h;
    if (full && len >= 150 && lampIndex++ % 2 === 0) {
      const side = (o.id % 2) * 2 - 1;
      const t = 0.3 + ((o.id * 37) % 40) / 100;
      const lx = horizontal ? o.x + o.w * t : side > 0 ? o.x + o.w : o.x;
      const ly = horizontal ? (side > 0 ? o.y + o.h : o.y) : o.y + o.h * t;
      const nx = horizontal ? 0 : side;
      const ny = horizontal ? side : 0;
      solid.add(lampHousing, tiledBox(lx - 7 + nx * 3, ly - 7 + ny * 3, 14, 14, 6, 56, 16));
      glows.add(lampGlow, tiledBox(lx - 5 + nx * 5, ly - 5 + ny * 5, 10, 10, 1.5, 54.5, 16));
      lights.add(warmCone, edgeStrip(lx - ny * 60, ly - nx * 60, lx + ny * 60, ly + nx * 60, nx, ny, 170, Y.light, 1));
    }
  }

  // --- Zone set dressing ------------------------------------------------------------
  const scatter = (area: Rect, count: number, r: number, fn: (x: number, y: number) => void, allowInside = false) => {
    for (let i = 0, tries = 0; i < count && tries < count * 12; tries++) {
      const x = area.x + rand() * area.w;
      const y = area.y + rand() * area.h;
      if (!free(x, y, r) || (!allowInside && inInterior(x, y)) || onVault(x, y)) continue;
      fn(x, y);
      i++;
    }
  };

  if (full) {
    // City: manholes, cracks, oil, puddles, parking bays around parked cars.
    if (cityZone) {
      scatter(cityZone, 14, 22, (x, y) => paint.add(manholeMat, rectDecal(x - 16, y - 16, 32, 32, Y.paint, rand() * 3)));
      scatter(cityZone, 26, 40, (x, y) => shade.add(crackMat, rectDecal(x - 70, y - 70, 140, 140, Y.stain, rand() * 6)));
      scatter(cityZone, 12, 30, (x, y) => shade.add(oilMat, rectDecal(x - 30, y - 30, 60, 60, Y.stain, rand() * 6)));
      scatter(cityZone, 9, 50, (x, y) => wet.add(puddleMat, rectDecal(x - 60, y - 42, 120, 84, Y.stain, rand() * 6)));
    }
    for (const o of map.obstacles) {
      if (o.kind !== 'rect' || o.style !== 'vehicle') continue;
      const onRoad = map.floors.some((f) => f.style === 'road' && pointInRect(o.x + o.w / 2, o.y + o.h / 2, f));
      if (!onRoad) {
        const horizontal = o.w >= o.h;
        const m = 12;
        if (horizontal) {
          paint.add(whitePaint, line(o.x - m, o.y - m, o.x - m, o.y + o.h + m, 3, Y.paint));
          paint.add(whitePaint, line(o.x + o.w + m, o.y - m, o.x + o.w + m, o.y + o.h + m, 3, Y.paint));
        } else {
          paint.add(whitePaint, line(o.x - m, o.y - m, o.x + o.w + m, o.y - m, 3, Y.paint));
          paint.add(whitePaint, line(o.x - m, o.y + o.h + m, o.x + o.w + m, o.y + o.h + m, 3, Y.paint));
        }
      }
      shade.add(oilMat, rectDecal(o.x + o.w / 2 - 22, o.y + o.h / 2 - 22, 44, 44, Y.stain, o.id));
    }

    // Factory: painted walkways + HALL stencils in halls, hatch at doors, yard stains.
    const factory = zone('FACTORY');
    if (factory) {
      const halls = map.floors.filter((f) => f.style === 'interior' && pointInRect(f.x + f.w / 2, f.y + f.h / 2, factory));
      halls.forEach((h, i) => {
        const m = 46;
        const r = { x: h.x + m, y: h.y + m, w: h.w - 2 * m, h: h.h - 2 * m };
        paint.add(yellowPaint, line(r.x, r.y, r.x + r.w, r.y, 5, Y.paint));
        paint.add(yellowPaint, line(r.x, r.y + r.h, r.x + r.w, r.y + r.h, 5, Y.paint));
        paint.add(yellowPaint, line(r.x, r.y, r.x, r.y + r.h, 5, Y.paint));
        paint.add(yellowPaint, line(r.x + r.w, r.y, r.x + r.w, r.y + r.h, 5, Y.paint));
        paint.add(stencil(`HALL ${String.fromCharCode(65 + i)}`, 0.28, 0xd9a91e), rectDecal(h.x + h.w / 2 - 110, h.y + h.h * 0.72 - 27, 220, 55, Y.paint));
        // Doors: gaps in the wall ring at side centres -> hazard hatch outside.
        const sides: [number, number, number, number, number][] = [
          [h.x + h.w / 2, h.y - 20, 0, -1, 0],
          [h.x + h.w / 2, h.y + h.h + 20, 0, 1, 0],
          [h.x - 20, h.y + h.h / 2, -1, 0, Math.PI / 2],
          [h.x + h.w + 20, h.y + h.h / 2, 1, 0, Math.PI / 2],
        ];
        for (const [x, y, nx, ny, rot] of sides) {
          if (!free(x, y, 6)) continue;
          paint.add(hatchPaint, rectDecal(x + nx * 30 - 60, y + ny * 30 - 22, 120, 44, Y.paint, rot));
          lights.add(warmPool, rectDecal(x + nx * 40 - 90, y + ny * 40 - 90, 180, 180, Y.light));
        }
        // Light pools under the hall ceiling lamps.
        for (const fx of [0.25, 0.75]) for (const fy of [0.3, 0.7]) lights.add(decalMat('additive', Decals.lightPool(), COLORS.lampCool, 0.16), rectDecal(h.x + h.w * fx - 140, h.y + h.h * fy - 140, 280, 280, Y.light));
      });
      scatter(factory, 16, 30, (x, y) => shade.add(oilMat, rectDecal(x - 34, y - 34, 68, 68, Y.stain, rand() * 6)));
      scatter(factory, 10, 30, (x, y) => shade.add(tireMat, rectDecal(x - 100, y - 45, 200, 90, Y.stain, rand() * 6)));
      scatter(factory, 6, 50, (x, y) => paint.add(arrowPaint, rectDecal(x - 50, y - 25, 100, 50, Y.paint, Math.round(rand() * 4) * (Math.PI / 2))));
    }

    // Port: container bay lines + IDs, quay edge hatch, oil and puddles.
    const port = zone('PORT');
    if (port) {
      let bay = 1;
      for (const o of map.obstacles) {
        if (o.kind !== 'rect' || o.style !== 'container' || !pointInRect(o.x + o.w / 2, o.y + o.h / 2, port)) continue;
        const m = 9;
        paint.add(yellowPaint, line(o.x - m, o.y - m, o.x + o.w + m, o.y - m, 4, Y.paint));
        paint.add(yellowPaint, line(o.x - m, o.y + o.h + m, o.x + o.w + m, o.y + o.h + m, 4, Y.paint));
        paint.add(yellowPaint, line(o.x - m, o.y - m, o.x - m, o.y + o.h + m, 4, Y.paint));
        paint.add(yellowPaint, line(o.x + o.w + m, o.y - m, o.x + o.w + m, o.y + o.h + m, 4, Y.paint));
        paint.add(stencil(`B-${String(bay++).padStart(2, '0')}`, 0.4, 0xd9a91e), rectDecal(o.x - m - 40, o.y + o.h / 2 - 14, 36, 28, Y.paint, -Math.PI / 2));
      }
      paint.add(hatchPaint, rectDecal(port.x + port.w - 26, port.y, 22, port.h, Y.paint));
      paint.add(hatchPaint, rectDecal(port.x, port.y + port.h - 26, port.w, 22, Y.paint));
      scatter(port, 14, 30, (x, y) => shade.add(oilMat, rectDecal(x - 30, y - 30, 60, 60, Y.stain, rand() * 6)));
      scatter(port, 8, 50, (x, y) => wet.add(puddleMat, rectDecal(x - 70, y - 45, 140, 90, Y.stain, rand() * 6)));
    }

    // Gas station: bay lines, arrows, stains, canopy light.
    const gas = zone('GAS_STATION');
    if (gas) {
      for (const o of map.obstacles) {
        if (o.kind !== 'rect' || o.style !== 'pump') continue;
        lights.add(decalMat('additive', Decals.lightPool(), COLORS.lampCool, 0.3), rectDecal(o.x + o.w / 2 - 110, o.y + o.h / 2 - 110, 220, 220, Y.light));
        shade.add(oilMat, rectDecal(o.x - 40, o.y + o.h / 2 - 20, 40, 40, Y.stain, o.id));
      }
      scatter(gas, 4, 40, (x, y) => paint.add(arrowPaint, rectDecal(x - 50, y - 25, 100, 50, Y.paint, Math.PI / 2)));
    }

    // Forest floor: darker undergrowth patches.
    const forest = zone('FOREST');
    if (forest) scatter(forest, 40, 30, (x, y) => shade.add(decalMat('shade', Decals.oil(), 0x0b1408, 0.45), rectDecal(x - 60, y - 60, 120, 120, Y.stain, rand() * 6)));

    // Faint sector stencils instead of giant zone names.
    map.zones.forEach((z, i) => {
      if (z.type === 'HIGH_VALUE' || z.type === 'GAS_STATION') return;
      const text = `SECTOR ${i + 1} · ${z.name.toUpperCase()}`;
      for (const [fx, fy] of [[0.5, 0.06], [0.5, 0.94]] as const) {
        const x = z.x + z.w * fx;
        const y = z.y + z.h * fy;
        if (free(x, y, 40) && !inInterior(x, y)) paint.add(stencil(text, 0.22), rectDecal(x - 170, y - 22, 340, 44, Y.paint));
      }
    });
  }

  // Vault: floor emblem, inner hazard ring, gold light.
  if (vault) {
    paint.add(decalMat('paint', Decals.emblem(), 0xf5c542, 0.3), rectDecal(vault.x + vault.w / 2 - 190, vault.y + vault.h / 2 - 190, 380, 380, Y.paint));
    const m = 34;
    const r = { x: vault.x + m, y: vault.y + m, w: vault.w - 2 * m, h: vault.h - 2 * m };
    for (const [ax, ay, bx, by] of [
      [r.x, r.y, r.x + r.w, r.y],
      [r.x, r.y + r.h, r.x + r.w, r.y + r.h],
      [r.x, r.y, r.x, r.y + r.h],
      [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
    ] as const) {
      paint.add(hatchPaint, line(ax, ay, bx, by, 12, Y.paint, 64));
    }
    for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
      lights.add(goldPool, rectDecal(vault.x + vault.w * fx - 120, vault.y + vault.h * fy - 120, 240, 240, Y.light));
    }
  }

  // Extraction pads (always painted; the live ring/beam comes from Effects).
  for (const p of map.extractionPoints) {
    const s = p.radius * 2.1;
    paint.add(decalMat('paint', Decals.pad(), 0xe6e3d8, 0.5), rectDecal(p.x - s / 2, p.y - s / 2, s, s, Y.pad));
    shade.add(shadowMat, softRect({ x: p.x - p.radius * 0.9, y: p.y - p.radius * 0.9, w: p.radius * 1.8, h: p.radius * 1.8 }, 30, Y.shadow - 0.02));
  }

  // --- Trees & rocks (instanced) ------------------------------------------------------
  const trees = map.obstacles.filter((o) => o.kind === 'circle' && o.style === 'tree');
  const rocks = map.obstacles.filter((o) => o.kind === 'circle' && o.style !== 'tree');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  for (const t of [...trees, ...rocks]) {
    if (t.kind !== 'circle') continue;
    shade.add(shadowMat, softRect({ x: t.x - t.r * 0.5, y: t.y - t.r * 0.5, w: t.r, h: t.r }, t.r * 0.7, Y.shadow));
  }

  if (trees.length) {
    const pines = trees.filter((_, i) => i % 5 < 3);
    const broad = trees.filter((_, i) => i % 5 >= 3);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.3, 1, 7), mat(COLORS.treeTrunk, { rough: 1 }), trees.length);
    const coneGeo = new THREE.ConeGeometry(1, 1, 8);
    const pineMat = () => withProximityFade(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }));
    const pineLayers = [0, 1, 2].map(() => new THREE.InstancedMesh(coneGeo, pineMat(), Math.max(1, pines.length)));
    const leafGeo = new THREE.IcosahedronGeometry(1, 1);
    const pos = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.85 + ((Math.sin(pos.getX(i) * 12.9 + pos.getY(i) * 78.2 + pos.getZ(i) * 37.7) + 1) / 2) * 0.3;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    leafGeo.computeVertexNormals();
    const canopyLow = new THREE.InstancedMesh(leafGeo, pineMat(), Math.max(1, broad.length));
    const canopyTop = new THREE.InstancedMesh(leafGeo, pineMat(), Math.max(1, broad.length));

    trees.forEach((t, i) => {
      if (t.kind !== 'circle') return;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m4.compose(v3(t.x, 30, t.y), q, v3(t.r * 0.2, 60, t.r * 0.2));
      trunk.setMatrixAt(i, m4);
    });
    pines.forEach((t, i) => {
      if (t.kind !== 'circle') return;
      const r = t.r * 1.25;
      const base = COLORS.pine[i % COLORS.pine.length]!;
      const shade0 = 0.85 + rand() * 0.3;
      [
        [54, 1, 46],
        [84, 0.78, 40],
        [110, 0.52, 34],
      ].forEach(([y, sc, h], layer) => {
        q.setFromAxisAngle(up, rand() * Math.PI);
        m4.compose(v3(t.x, y! + r * 0.2, t.y), q, v3(r * sc!, h! + r * 0.3, r * sc!));
        pineLayers[layer]!.setMatrixAt(i, m4);
        color.setHex(base).multiplyScalar(shade0 * (1 + layer * 0.12));
        pineLayers[layer]!.setColorAt(i, color);
      });
    });
    broad.forEach((t, i) => {
      if (t.kind !== 'circle') return;
      const r = t.r;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m4.compose(v3(t.x, 78 + r * 0.3, t.y), q, v3(r * 1.15, r * 0.8, r * 1.15));
      canopyLow.setMatrixAt(i, m4);
      color.setHex(COLORS.treeCanopy[i % COLORS.treeCanopy.length]!).multiplyScalar(0.85 + rand() * 0.3);
      canopyLow.setColorAt(i, color);
      m4.compose(v3(t.x + (rand() - 0.5) * r * 0.3, 102 + r * 0.55, t.y + (rand() - 0.5) * r * 0.3), q, v3(r * 0.75, r * 0.62, r * 0.75));
      canopyTop.setMatrixAt(i, m4);
      color.multiplyScalar(1.15);
      canopyTop.setColorAt(i, color);
    });
    for (const mesh of [trunk, ...pineLayers, canopyLow, canopyTop]) {
      mesh.castShadow = true;
      mesh.receiveShadow = mesh === trunk;
      root.add(mesh);
    }
  }

  if (rocks.length) {
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const rp = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const k = 0.78 + ((Math.sin(rp.getX(i) * 9.1 + rp.getY(i) * 41.3 + rp.getZ(i) * 17.9) + 1) / 2) * 0.4;
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.9, rp.getZ(i) * k);
    }
    rockGeo.computeVertexNormals();
    const rockMesh = new THREE.InstancedMesh(rockGeo, surface(0xffffff, Textures.slab(), { rough: 0.95, normal: 1.6, flat: true }), rocks.length);
    rocks.forEach((o, i) => {
      if (o.kind !== 'circle') return;
      q.setFromEuler(new THREE.Euler(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4));
      m4.compose(v3(o.x, o.r * 0.25, o.y), q, v3(o.r * 1.1, o.r * 0.72, o.r * 1.1));
      rockMesh.setMatrixAt(i, m4);
      color.setHex(COLORS.rock).multiplyScalar(0.8 + rand() * 0.35);
      rockMesh.setColorAt(i, color);
    });
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    root.add(rockMesh);
  }

  // --- Flush -------------------------------------------------------------------------
  solid.flush(root, { cast: true, receive: true });
  glows.flush(root, { cast: false, receive: false });
  shade.flush(root, { cast: false, receive: false, renderOrder: 1 });
  wet.flush(root, { cast: false, receive: true, renderOrder: 2 });
  paint.flush(root, { cast: false, receive: true, renderOrder: 2 });
  lights.flush(root, { cast: false, receive: false, renderOrder: 3 });

  return {
    root,
    setVaultActive(active: boolean, time: number) {
      kit.vaultTrim.emissiveIntensity = active ? 1.6 + Math.sin(time / 300) * 0.6 : 0.25;
    },
  };
}

