import type { ContainerType, FloorPatch, ObstacleStyle, ZoneType } from '@extract/game-types';

/** World-space heights (1 unit = 1 game unit). Purely visual. */
export const HEIGHT: Record<ObstacleStyle | 'border' | 'containerStack', number> = {
  wall: 72,
  container: 60,
  containerStack: 120,
  tree: 0,
  rock: 0,
  machine: 46,
  pump: 38,
  vault: 96,
  crate_stack: 44,
  border: 130,
  // Low cover sits just above gun height so shots visibly hit its top edge.
  barrier: 30,
  barrel: 34,
  pallet: 30,
  shelf: 70,
  generator: 40,
  vehicle: 36,
  sandbag: 26,
  fence: 64,
};

/** Height at which guns / bullets travel. */
export const GUN_HEIGHT = 26;

/**
 * Palette: stylised tactical realism. Muted, slightly desaturated materials;
 * colour is reserved for gameplay (rarity, extraction, danger, the player).
 */
export const COLORS = {
  background: 0x0d1115,
  sky: 0x9fb6d8,
  groundBounce: 0x3a2e24,
  sun: 0xffc690,
  rim: 0x6d8fbf,
  wall: 0x9b9d9e,
  wallBase: 0x55575a,
  wallCap: 0x3b3f44,
  border: 0x5e6268,
  rock: 0x6f7378,
  treeCanopy: [0x24442a, 0x2c5230, 0x1f3d25, 0x355a2f, 0x2a4a2c],
  pine: [0x1c3524, 0x21402a, 0x183020, 0x284a30],
  treeTrunk: 0x4a3524,
  lamp: 0xffc98a,
  lampCool: 0xa9d4ff,
  self: 0xb6f23d,
  extraction: 0x34d399,
  danger: 0xef4444,
  supply: 0xfb923c,
};

export type GroundKind = 'field' | 'forest' | 'asphalt' | 'slab' | 'quay' | 'epoxy' | 'officeTiles' | 'parquet' | 'tread';

export const ZONE_GROUND: Record<ZoneType, { kind: GroundKind; tint: number; tile: number }> = {
  OPEN: { kind: 'field', tint: 0xffffff, tile: 320 },
  FOREST: { kind: 'forest', tint: 0xffffff, tile: 300 },
  CITY: { kind: 'slab', tint: 0xb4b7ba, tile: 320 },
  FACTORY: { kind: 'slab', tint: 0xa39e93, tile: 320 },
  PORT: { kind: 'quay', tint: 0xa7adb3, tile: 320 },
  GAS_STATION: { kind: 'asphalt', tint: 0xffffff, tile: 256 },
  HIGH_VALUE: { kind: 'tread', tint: 0xb9a38a, tile: 110 },
};

export const FLOOR_GROUND: Record<FloorPatch['style'], { kind: GroundKind; tint: number; tile: number; y: number }> = {
  road: { kind: 'asphalt', tint: 0xffffff, tile: 256, y: 1.2 },
  concrete: { kind: 'slab', tint: 0xc9ccd0, tile: 256, y: 1.4 },
  dock: { kind: 'quay', tint: 0xb2b6ba, tile: 320, y: 1.0 },
  interior: { kind: 'epoxy', tint: 0xd0d6d3, tile: 256, y: 2.0 },
  vault_floor: { kind: 'tread', tint: 0xc9a979, tile: 110, y: 2.0 },
  water: { kind: 'asphalt', tint: 0x2a5170, tile: 256, y: 0.8 },
};

export const CRATE_STYLE: Record<ContainerType, { color: number; trim: number; glow: number | null; size: number }> = {
  NORMAL: { color: 0xb08850, trim: 0x3a2a18, glow: null, size: 42 },
  MILITARY: { color: 0x5d6b43, trim: 0x22281a, glow: null, size: 44 },
  RARE: { color: 0x3a4a60, trim: 0x16254a, glow: 0x60a5fa, size: 44 },
  LEGENDARY: { color: 0x1e1f23, trim: 0xf5b301, glow: 0xf5b301, size: 46 },
  SUPPLY_DROP: { color: 0xd8570d, trim: 0x2a1406, glow: 0xfb923c, size: 58 },
};
