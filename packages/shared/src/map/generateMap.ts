import { EXTRACTION_CONFIG, MAP_CONFIG } from '@extract/game-config';
import type {
  ContainerType,
  CrateSpawn,
  FloorPatch,
  MapData,
  MapZone,
  Obstacle,
  ObstacleStyle,
  Vec2,
  ZoneType,
} from '@extract/game-types';
import { CollisionWorld } from '../collision';
import { dist2, pointInRect } from '../math';
import { Rng } from '../rng';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Side = 'top' | 'bottom' | 'left' | 'right';
const SIDES: Side[] = ['top', 'bottom', 'left', 'right'];
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

const ROAD_WIDTH = 140;
const CRATE_CLEARANCE = 26;
const CRATE_SPACING = 70;

function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y
  );
}

class MapBuilder {
  readonly obstacles: Obstacle[] = [];
  readonly floors: FloorPatch[] = [];
  readonly crates: CrateSpawn[] = [];
  readonly spots: { x: number; y: number; zone: ZoneType }[] = [];
  /** Factory hall interiors (storage racks go along their walls). */
  readonly halls: Rect[] = [];
  readonly roadRects: readonly Rect[];
  private nextId = 1;
  private readonly roads: Rect[];
  private readonly reserved: { x: number; y: number; r: number }[];

  constructor(
    readonly rng: Rng,
    readonly width: number,
    readonly height: number,
  ) {
    const c = width / 2;
    this.roads = [
      { x: c - ROAD_WIDTH / 2, y: 0, w: ROAD_WIDTH, h: height },
      { x: 0, y: c - ROAD_WIDTH / 2, w: width, h: ROAD_WIDTH },
    ];
    this.reserved = MAP_CONFIG.extractionPoints.map((p) => ({ x: p.x, y: p.y, r: EXTRACTION_CONFIG.radius + 50 }));
    for (const r of this.roads) this.floors.push({ ...r, style: 'road' });
    this.roadRects = this.roads;
  }

  /** True when `r` keeps at least `gap` units of walkable space to every obstacle. */
  clearOf(r: Rect, gap: number, ignore?: (o: Obstacle) => boolean): boolean {
    return !this.obstacles.some((o) => {
      if (ignore?.(o)) return false;
      if (o.kind === 'rect') return rectsOverlap(r, o, gap);
      const cx = Math.max(r.x, Math.min(o.x, r.x + r.w));
      const cy = Math.max(r.y, Math.min(o.y, r.y + r.h));
      return dist2(cx, cy, o.x, o.y) < (o.r + gap) * (o.r + gap);
    });
  }

  /**
   * Places a rectangular prop somewhere in `area` (randomly rotated by 90 degrees
   * unless `rotate` is false) with a walkable gap to everything else, off
   * roads, extraction zones and preferred loot spots. Returns null if no
   * spot was found.
   */
  prop(
    area: Rect,
    w: number,
    h: number,
    style: ObstacleStyle,
    opts: { gap?: number; allowRoad?: boolean; rotate?: boolean; tint?: number; avoid?: Rect[] } = {},
  ): Rect | null {
    const gap = opts.gap ?? MAP_CONFIG.generation.props.gap;
    for (let attempt = 0; attempt < 40; attempt++) {
      const flip = opts.rotate !== false && this.rng.chance(0.5);
      const pw = flip ? h : w;
      const ph = flip ? w : h;
      if (area.w < pw || area.h < ph) return null;
      const r = { x: this.rng.range(area.x, area.x + area.w - pw), y: this.rng.range(area.y, area.y + area.h - ph), w: pw, h: ph };
      if (!opts.allowRoad && this.rectOnRoad(r, 16)) continue;
      if (this.rectReserved(r) || opts.avoid?.some((a) => rectsOverlap(r, a, 0))) continue;
      if (this.spots.some((sp) => pointInRect(sp.x, sp.y, { x: r.x - 45, y: r.y - 45, w: r.w + 90, h: r.h + 90 }))) continue;
      if (!this.clearOf(r, gap)) continue;
      this.rect(r.x, r.y, r.w, r.h, style, opts.tint);
      return r;
    }
    return null;
  }

  rect(x: number, y: number, w: number, h: number, style: ObstacleStyle, tint?: number): void {
    if (w <= 0 || h <= 0) return;
    const o: Obstacle = { kind: 'rect', id: this.nextId++, x, y, w, h, style };
    if (tint !== undefined) o.tint = tint;
    this.obstacles.push(o);
  }

  circle(x: number, y: number, r: number, style: ObstacleStyle): void {
    this.obstacles.push({ kind: 'circle', id: this.nextId++, x, y, r, style });
  }

  floor(x: number, y: number, w: number, h: number, style: FloorPatch['style']): void {
    this.floors.push({ x, y, w, h, style });
  }

  spot(x: number, y: number, zone: ZoneType): void {
    this.spots.push({ x, y, zone });
  }

  onRoad(x: number, y: number, margin: number): boolean {
    return this.roads.some((r) => x > r.x - margin && x < r.x + r.w + margin && y > r.y - margin && y < r.y + r.h + margin);
  }

  rectOnRoad(r: Rect, margin = 10): boolean {
    return this.roads.some((road) => rectsOverlap(r, road, margin));
  }

  isReserved(x: number, y: number, r: number): boolean {
    return this.reserved.some((c) => dist2(x, y, c.x, c.y) < (c.r + r) * (c.r + r));
  }

  rectReserved(r: Rect): boolean {
    return this.reserved.some((c) => {
      const cx = Math.max(r.x, Math.min(c.x, r.x + r.w));
      const cy = Math.max(r.y, Math.min(c.y, r.y + r.h));
      return dist2(cx, cy, c.x, c.y) < c.r * c.r;
    });
  }

  /** Horizontal wall with an optional door gap centered at gapCenter. */
  wallH(x: number, y: number, len: number, t: number, gapCenter: number | null, gapW: number): void {
    if (gapCenter === null) return this.rect(x, y, len, t, 'wall');
    const g0 = gapCenter - gapW / 2;
    const g1 = gapCenter + gapW / 2;
    this.rect(x, y, g0 - x, t, 'wall');
    this.rect(g1, y, x + len - g1, t, 'wall');
  }

  wallV(x: number, y: number, len: number, t: number, gapCenter: number | null, gapW: number): void {
    if (gapCenter === null) return this.rect(x, y, t, len, 'wall');
    const g0 = gapCenter - gapW / 2;
    const g1 = gapCenter + gapW / 2;
    this.rect(x, y, t, g0 - y, 'wall');
    this.rect(x, g1, t, y + len - g1, 'wall');
  }

  /** Hollow building with door gaps; returns the interior rect. */
  building(b: Rect, t: number, doorW: number, doors: Side[], floorStyle: FloorPatch['style'] = 'interior', centered = false): Rect {
    this.floor(b.x, b.y, b.w, b.h, floorStyle);
    const gap = (from: number, len: number) =>
      centered ? from + len / 2 : from + this.rng.range(doorW / 2 + t + 12, len - doorW / 2 - t - 12);
    this.wallH(b.x, b.y, b.w, t, doors.includes('top') ? gap(b.x, b.w) : null, doorW);
    this.wallH(b.x, b.y + b.h - t, b.w, t, doors.includes('bottom') ? gap(b.x, b.w) : null, doorW);
    this.wallV(b.x, b.y + t, b.h - 2 * t, t, doors.includes('left') ? gap(b.y + t, b.h - 2 * t) : null, doorW);
    this.wallV(b.x + b.w - t, b.y + t, b.h - 2 * t, t, doors.includes('right') ? gap(b.y + t, b.h - 2 * t) : null, doorW);
    return { x: b.x + t, y: b.y + t, w: b.w - 2 * t, h: b.h - 2 * t };
  }

  /** Scatters circular obstacles with a guaranteed walkable gap between them. */
  scatterCircles(area: Rect, count: number, rRange: readonly [number, number], style: ObstacleStyle, exclude: Rect[] = []): void {
    const gap = 56;
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 25; attempt++) {
        const r = this.rng.range(rRange[0], rRange[1]);
        const x = this.rng.range(area.x + r, area.x + area.w - r);
        const y = this.rng.range(area.y + r, area.y + area.h - r);
        if (this.onRoad(x, y, r + 20) || this.isReserved(x, y, r)) continue;
        if (exclude.some((e) => rectsOverlap({ x: x - r, y: y - r, w: 2 * r, h: 2 * r }, e, 30))) continue;
        const blocked = this.obstacles.some((o) => {
          if (o.kind === 'circle') return dist2(x, y, o.x, o.y) < (r + o.r + gap) ** 2;
          return rectsOverlap({ x: x - r, y: y - r, w: 2 * r, h: 2 * r }, o, gap);
        });
        if (blocked) continue;
        this.circle(x, y, r, style);
        break;
      }
    }
  }
}

function zoneRect(type: ZoneType): MapZone {
  const z = MAP_CONFIG.zones.find((zone) => zone.type === type);
  if (!z) throw new Error(`Zone ${type} missing from MAP_CONFIG`);
  return z;
}

function buildCity(b: MapBuilder): void {
  const zone = zoneRect('CITY');
  const g = MAP_CONFIG.generation.city;
  const lotW = zone.w / g.gridCols;
  const lotH = zone.h / g.gridRows;
  for (let i = 0; i < g.gridCols; i++) {
    for (let j = 0; j < g.gridRows; j++) {
      const lot = { x: zone.x + i * lotW, y: zone.y + j * lotH, w: lotW, h: lotH };
      const inner = { x: lot.x + g.lotPadding, y: lot.y + g.lotPadding, w: lot.w - 2 * g.lotPadding, h: lot.h - 2 * g.lotPadding };
      b.floor(lot.x + 8, lot.y + 8, lot.w - 16, lot.h - 16, 'concrete');
      if (b.rectReserved(inner) || b.rng.chance(0.18)) {
        // Plaza: light cover, loot in the open.
        for (let k = 0; k < 3; k++) {
          const x = b.rng.range(inner.x + 30, inner.x + inner.w - 70);
          const y = b.rng.range(inner.y + 30, inner.y + inner.h - 70);
          if (!b.isReserved(x, y, 60)) b.rect(x, y, 44, 44, 'crate_stack');
        }
        b.spot(inner.x + inner.w / 2, inner.y + inner.h / 2, 'CITY');
        continue;
      }
      const w = inner.w * b.rng.range(0.72, 1);
      const h = inner.h * b.rng.range(0.72, 1);
      const rect = { x: inner.x + b.rng.range(0, inner.w - w), y: inner.y + b.rng.range(0, inner.h - h), w, h };
      const first = b.rng.pick(SIDES);
      const doors: Side[] = b.rng.chance(0.55) ? [first, OPPOSITE[first]] : [first];
      const interior = b.building(rect, g.wallThickness, g.doorWidth, doors);
      // Interior partition for bigger buildings.
      if (interior.w > 200 && b.rng.chance(0.5)) {
        const px = interior.x + interior.w / 2;
        b.wallV(px - 6, interior.y, interior.h, 12, interior.y + interior.h / 2, 80);
      }
      b.spot(interior.x + 45, interior.y + 45, 'CITY');
      b.spot(interior.x + interior.w - 45, interior.y + interior.h - 45, 'CITY');
      b.spot(interior.x + interior.w - 45, interior.y + 45, 'CITY');
    }
  }
}

function buildFactory(b: MapBuilder): void {
  const zone = zoneRect('FACTORY');
  const g = MAP_CONFIG.generation.factory;
  b.floor(zone.x, zone.y, zone.w, zone.h, 'concrete');
  const cellW = zone.w / 2;
  const cellH = zone.h / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const cell = { x: zone.x + i * cellW, y: zone.y + j * cellH, w: cellW, h: cellH };
      let hall: Rect | null = null;
      for (let attempt = 0; attempt < 30 && !hall; attempt++) {
        const w = b.rng.range(0.62, 0.8) * cellW;
        const h = b.rng.range(0.6, 0.78) * cellH;
        const cand = { x: cell.x + b.rng.range(40, cellW - w - 40), y: cell.y + b.rng.range(40, cellH - h - 40), w, h };
        if (!b.rectReserved(cand) && !b.rectOnRoad(cand, 30)) hall = cand;
      }
      if (!hall) continue;
      const vertical = b.rng.chance(0.5);
      const doors: Side[] = vertical ? ['top', 'bottom'] : ['left', 'right'];
      if (b.rng.chance(0.5)) doors.push(vertical ? 'left' : 'top');
      const interior = b.building(hall, g.wallThickness, g.doorWidth, doors, 'interior', true);
      b.halls.push(interior);
      // Machines in the interior quadrants (doors are centered, so the middle cross stays free).
      const quads = [
        { x: interior.x + 40, y: interior.y + 40 },
        { x: interior.x + interior.w / 2 + 70, y: interior.y + 40 },
        { x: interior.x + 40, y: interior.y + interior.h / 2 + 70 },
        { x: interior.x + interior.w / 2 + 70, y: interior.y + interior.h / 2 + 70 },
      ];
      b.rng.shuffle(quads);
      const qW = interior.w / 2 - 110;
      const qH = interior.h / 2 - 110;
      quads.slice(0, g.machinesPerHall).forEach((q) => {
        const mw = Math.min(qW, b.rng.range(80, 140));
        const mh = Math.min(qH, b.rng.range(60, 100));
        if (mw > 30 && mh > 30) b.rect(q.x, q.y, mw, mh, 'machine');
      });
      b.spot(interior.x + interior.w / 2, interior.y + interior.h / 2, 'FACTORY');
      b.spot(interior.x + interior.w - 60, interior.y + interior.h - 60, 'FACTORY');
      b.spot(interior.x + 60, interior.y + interior.h - 60, 'FACTORY');
    }
  }
}

function buildForest(b: MapBuilder): void {
  const zone = zoneRect('FOREST');
  const g = MAP_CONFIG.generation.forest;
  b.scatterCircles(zone, g.trees, g.treeRadius, 'tree');
  b.scatterCircles(zone, g.rocks, g.rockRadius, 'rock');
}

function buildPort(b: MapBuilder): void {
  const zone = zoneRect('PORT');
  const g = MAP_CONFIG.generation.port;
  b.floor(zone.x, zone.y, zone.w, zone.h, 'dock');
  const [cw, ch] = g.containerSize;
  const rowSpacing = (zone.h - 160) / g.containerRows;
  const colSpacing = (zone.w - 120) / g.containersPerRow;
  for (let row = 0; row < g.containerRows; row++) {
    for (let col = 0; col < g.containersPerRow; col++) {
      if (b.rng.chance(0.3)) continue;
      const x = zone.x + 60 + col * colSpacing + b.rng.range(0, colSpacing - cw);
      const y = zone.y + 90 + row * rowSpacing + b.rng.range(0, 40);
      const r = { x, y, w: cw, h: ch };
      if (b.rectReserved(r) || b.rectOnRoad(r, 20)) continue;
      b.rect(x, y, cw, ch, 'container', b.rng.int(0, 4));
      b.spot(x + cw / 2, y + ch + 45, 'PORT');
    }
  }
}

function buildGasStation(b: MapBuilder): void {
  const zone = zoneRect('GAS_STATION');
  b.floor(zone.x, zone.y, zone.w, zone.h, 'concrete');
  const center = b.width / 2;
  const shop = { x: center + ROAD_WIDTH / 2 + 50, y: zone.y + 70, w: 170, h: 160 };
  const interior = b.building(shop, 14, 70, ['left'], 'interior', true);
  b.spot(interior.x + interior.w / 2, interior.y + 40, 'GAS_STATION');
  b.spot(interior.x + interior.w / 2, interior.y + interior.h - 40, 'GAS_STATION');
  const pumpX = [center - ROAD_WIDTH / 2 - 150, center - ROAD_WIDTH / 2 - 70];
  const pumpY = [zone.y + 140, zone.y + 280];
  for (const px of pumpX) for (const py of pumpY) b.rect(px, py, 26, 46, 'pump');
  b.spot(pumpX[0]! - 60, zone.y + 220, 'GAS_STATION');
  b.spot(center + ROAD_WIDTH / 2 + 130, zone.y + zone.h - 80, 'GAS_STATION');
}

function buildVault(b: MapBuilder): Vec2[] {
  const zone = zoneRect('HIGH_VALUE');
  const g = MAP_CONFIG.generation.vault;
  const interior = b.building(zone, g.wallThickness, g.gateWidth, ['top', 'bottom', 'left', 'right'], 'vault_floor', true);
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  const off = 150;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.rect(cx + dx * off - 22, cy + dy * off - 22, 44, 44, 'vault');
  }
  // Crate ring inside the vault.
  const spots: Vec2[] = [];
  const ring = [
    [0, 0], [-80, 0], [80, 0], [0, -80], [0, 80],
    [-220, -220], [220, -220], [-220, 220], [220, 220],
    [-220, 0], [220, 0], [0, -220], [0, 220],
  ] as const;
  for (const [dx, dy] of ring) {
    const x = cx + dx;
    const y = cy + dy;
    if (x > interior.x + 30 && x < interior.x + interior.w - 30 && y > interior.y + 30 && y < interior.y + interior.h - 30) {
      spots.push({ x, y });
    }
  }
  return spots;
}

function buildOpenField(b: MapBuilder): void {
  const g = MAP_CONFIG.generation.openField;
  const zones = MAP_CONFIG.zones;
  const area = { x: 80, y: 80, w: b.width - 160, h: b.height - 160 };
  b.scatterCircles(area, g.trees, [22, 38], 'tree', zones);
  b.scatterCircles(area, g.rocks, [16, 28], 'rock', zones);
}

const SIZES = {
  barrier: [92, 20],
  barrel: [36, 36],
  pallet: [48, 48],
  generator: [64, 40],
  vehicle: [44, 92],
  sandbag: [84, 22],
  fence: [180, 10],
  shelf: [150, 28],
} as const;

type PropStyle = keyof typeof SIZES;

function scatterProps(b: MapBuilder, area: Rect, counts: Partial<Record<PropStyle, number>>, avoid: Rect[] = []): void {
  for (const [style, n] of Object.entries(counts) as [PropStyle, number][]) {
    if (style === 'shelf' || style === 'fence') continue;
    const [w, h] = SIZES[style];
    for (let i = 0; i < n; i++) b.prop(area, w, h, style, { tint: style === 'vehicle' ? b.rng.int(0, 2) : undefined, avoid });
  }
}

/** Short fence runs just inside a zone edge (fenced lanes); gaps in between keep it open. */
function edgeFences(b: MapBuilder, zone: Rect, count: number): void {
  const [len, t] = SIZES.fence;
  const strips: Rect[] = [
    { x: zone.x + 20, y: zone.y + 30, w: t + 1, h: zone.h - 60 },
    { x: zone.x + 30, y: zone.y + zone.h - 20 - t, w: zone.w - 60, h: t + 1 },
  ];
  for (let i = 0; i < count; i++) {
    const strip = strips[i % strips.length]!;
    const vertical = strip.w < strip.h;
    b.prop(strip, vertical ? t : len, vertical ? len : t, 'fence', { rotate: false });
  }
}

/** Storage racks along factory hall walls; the centred doors stay clear. */
function hallShelves(b: MapBuilder, perHall: number): void {
  const [len, depth] = SIZES.shelf;
  const inset = 10;
  for (const hall of b.halls) {
    const slots: Rect[] = [
      { x: hall.x + 26, y: hall.y + inset, w: len, h: depth },
      { x: hall.x + hall.w - 26 - len, y: hall.y + inset, w: len, h: depth },
      { x: hall.x + 26, y: hall.y + hall.h - inset - depth, w: len, h: depth },
      { x: hall.x + hall.w - 26 - len, y: hall.y + hall.h - inset - depth, w: len, h: depth },
      { x: hall.x + inset, y: hall.y + 26, w: depth, h: len },
      { x: hall.x + hall.w - inset - depth, y: hall.y + hall.h - 26 - len, w: depth, h: len },
    ];
    let placed = 0;
    for (const r of b.rng.shuffle(slots)) {
      if (placed >= perHall) break;
      // Racks stand against the wall; they may sit close to machines (a gap narrower
      // than a player just reads as one block) but never overlap anything.
      if (!b.clearOf(r, 1)) continue;
      if (b.spots.some((sp) => pointInRect(sp.x, sp.y, { x: r.x - 10, y: r.y - 10, w: r.w + 20, h: r.h + 20 }))) continue;
      b.rect(r.x, r.y, r.w, r.h, 'shelf');
      placed++;
    }
  }
}

/** Wrecked vehicles parked along the road edges (lanes stay passable). */
function roadVehicles(b: MapBuilder, count: number): void {
  const [cw, cl] = SIZES.vehicle;
  const keepOut = [
    { x: 1560, y: 1560, w: 880, h: 880 }, // crossing + vault gates
    zoneRect('GAS_STATION'),
  ];
  for (let i = 0; i < count; i++) {
    const road = b.roadRects[i % b.roadRects.length]!;
    const vertical = road.h > road.w;
    const nearSide = b.rng.chance(0.5);
    const lane: Rect = vertical
      ? { x: nearSide ? road.x + 8 : road.x + road.w - 8 - cw, y: 120, w: cw, h: b.height - 240 }
      : { x: 120, y: nearSide ? road.y + 8 : road.y + road.h - 8 - cw, w: b.width - 240, h: cw };
    b.prop(lane, vertical ? cw : cl, vertical ? cl : cw, 'vehicle', { allowRoad: true, rotate: false, tint: b.rng.int(0, 2), avoid: keepOut });
  }
}

function buildProps(b: MapBuilder): void {
  const p = MAP_CONFIG.generation.props;
  const vault = zoneRect('HIGH_VALUE');
  const inner = (z: Rect, m = 60): Rect => ({ x: z.x + m, y: z.y + m, w: z.w - 2 * m, h: z.h - 2 * m });
  hallShelves(b, p.factory.shelvesPerHall);
  scatterProps(b, inner(zoneRect('CITY')), p.city);
  scatterProps(b, inner(zoneRect('FACTORY')), { pallet: p.factory.pallet, barrel: p.factory.barrel, generator: p.factory.generator });
  edgeFences(b, zoneRect('FACTORY'), p.factory.fence);
  scatterProps(b, inner(zoneRect('PORT')), { pallet: p.port.pallet, barrel: p.port.barrel, vehicle: p.port.vehicle });
  edgeFences(b, zoneRect('PORT'), p.port.fence);
  scatterProps(b, inner(zoneRect('FOREST')), p.forest);
  // Open ground between the quadrants (not inside other zones).
  scatterProps(b, { x: 120, y: 120, w: b.width - 240, h: b.height - 240 }, p.open, [...MAP_CONFIG.zones.filter((z) => z.type !== 'HIGH_VALUE'), vault]);
  roadVehicles(b, p.roadVehicles);
}

function buildBorder(b: MapBuilder): void {
  const t = MAP_CONFIG.border;
  b.rect(0, 0, b.width, t, 'wall');
  b.rect(0, b.height - t, b.width, t, 'wall');
  b.rect(0, t, t, b.height - 2 * t, 'wall');
  b.rect(b.width - t, t, t, b.height - 2 * t, 'wall');
}

export function zoneAt(zones: readonly MapZone[], x: number, y: number): ZoneType {
  // Specific zones take precedence over the large quadrants.
  for (const type of ['HIGH_VALUE', 'GAS_STATION'] as const) {
    const z = zones.find((zone) => zone.type === type);
    if (z && pointInRect(x, y, z)) return type;
  }
  for (const z of zones) if (pointInRect(x, y, z)) return z.type;
  return 'OPEN';
}

function placeCrates(b: MapBuilder, world: CollisionWorld, vaultSpots: Vec2[]): void {
  const placed: Vec2[] = [];
  const valid = (x: number, y: number): boolean =>
    !world.circleIntersects(x, y, CRATE_CLEARANCE) &&
    !b.isReserved(x, y, 20) &&
    !placed.some((p) => dist2(p.x, p.y, x, y) < CRATE_SPACING * CRATE_SPACING);

  const add = (x: number, y: number, type: ContainerType, zone: ZoneType): void => {
    placed.push({ x, y });
    b.crates.push({ x: Math.round(x), y: Math.round(y), type, zone, locked: zone === 'HIGH_VALUE' });
  };

  for (const [zoneType, counts] of Object.entries(MAP_CONFIG.crates) as [ZoneType, Partial<Record<ContainerType, number>>][]) {
    const types: ContainerType[] = [];
    for (const [type, n] of Object.entries(counts) as [ContainerType, number][]) for (let i = 0; i < n; i++) types.push(type);
    // Rarer containers first so they get the good (preferred) spots.
    const priority: Record<ContainerType, number> = { LEGENDARY: 0, SUPPLY_DROP: 0, RARE: 1, MILITARY: 2, NORMAL: 3 };
    types.sort((a, c) => priority[a] - priority[c]);

    const preferred =
      zoneType === 'HIGH_VALUE'
        ? vaultSpots.map((s) => ({ ...s, zone: zoneType }))
        : b.rng.shuffle(b.spots.filter((s) => s.zone === zoneType));
    const rect = zoneType === 'OPEN' ? { x: 100, y: 100, w: b.width - 200, h: b.height - 200 } : zoneRect(zoneType);

    for (const type of types) {
      let done = false;
      while (preferred.length > 0 && !done) {
        const s = preferred.shift()!;
        if (valid(s.x, s.y)) {
          add(s.x, s.y, type, zoneType);
          done = true;
        }
      }
      for (let attempt = 0; attempt < 200 && !done; attempt++) {
        const x = b.rng.range(rect.x + 40, rect.x + rect.w - 40);
        const y = b.rng.range(rect.y + 40, rect.y + rect.h - 40);
        if (zoneAt(MAP_CONFIG.zones, x, y) !== zoneType) continue;
        if (valid(x, y)) {
          add(x, y, type, zoneType);
          done = true;
        }
      }
    }
  }
}

function placeSpawns(b: MapBuilder, world: CollisionWorld): Vec2[] {
  const spawns: Vec2[] = [];
  const minDist = 110;
  for (let attempt = 0; attempt < MAP_CONFIG.spawnPointCount * 40 && spawns.length < MAP_CONFIG.spawnPointCount; attempt++) {
    const x = b.rng.range(120, b.width - 120);
    const y = b.rng.range(120, b.height - 120);
    if (zoneAt(MAP_CONFIG.zones, x, y) === 'HIGH_VALUE') continue;
    if (world.circleIntersects(x, y, 34) || b.isReserved(x, y, 60)) continue;
    if (spawns.some((s) => dist2(s.x, s.y, x, y) < minDist * minDist)) continue;
    spawns.push({ x: Math.round(x), y: Math.round(y) });
  }
  return spawns;
}

/** Builds the static map. Deterministic for a given seed. */
export function generateMap(seed: number = MAP_CONFIG.seed): MapData {
  const rng = new Rng(seed);
  const b = new MapBuilder(rng, MAP_CONFIG.width, MAP_CONFIG.height);
  buildBorder(b);
  buildCity(b);
  buildFactory(b);
  buildPort(b);
  buildGasStation(b);
  const vaultSpots = buildVault(b);
  buildForest(b);
  buildOpenField(b);
  buildProps(b);

  const world = new CollisionWorld(b.obstacles, b.width, b.height);
  placeCrates(b, world, vaultSpots);
  const spawnPoints = placeSpawns(b, world);

  return {
    id: MAP_CONFIG.id,
    name: MAP_CONFIG.name,
    width: b.width,
    height: b.height,
    zones: MAP_CONFIG.zones.map((z) => ({ ...z })),
    floors: b.floors,
    obstacles: b.obstacles,
    crates: b.crates,
    extractionPoints: MAP_CONFIG.extractionPoints.map((p) => ({ ...p, radius: EXTRACTION_CONFIG.radius })),
    spawnPoints,
  };
}
