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
};

/** Height at which guns / bullets travel. */
export const GUN_HEIGHT = 26;

export const COLORS = {
  sky: 0xa8c4e6,
  groundBounce: 0x2a2218,
  sun: 0xffe0bd,
  wall: 0x9aa1ab,
  wallCap: 0xc9ced6,
  border: 0x4b5260,
  containerTints: [0xb4412f, 0x2f5fa8, 0x3f8b4f, 0xc27a1c, 0x6b6f78],
  machine: 0x454c57,
  pump: 0xc0262d,
  vault: 0x3a3f48,
  vaultTrim: 0xf5b301,
  crateStack: 0x8a6a42,
  rock: 0x7c828c,
  treeCanopy: [0x2a5a30, 0x336b33, 0x244f29, 0x3c7236],
  treeTrunk: 0x5a3d25,
  self: 0xb6f23d,
  extraction: 0x34d399,
  danger: 0xef4444,
  supply: 0xfb923c,
};

export type GroundKind = 'grass' | 'forest' | 'asphalt' | 'concrete' | 'planks' | 'tiles' | 'metal';

export const ZONE_GROUND: Record<ZoneType, { kind: GroundKind; tint: number; tile: number }> = {
  OPEN: { kind: 'grass', tint: 0xffffff, tile: 300 },
  FOREST: { kind: 'forest', tint: 0xffffff, tile: 280 },
  CITY: { kind: 'concrete', tint: 0xb7bcc4, tile: 256 },
  FACTORY: { kind: 'concrete', tint: 0x9a968c, tile: 256 },
  PORT: { kind: 'concrete', tint: 0x8c98a6, tile: 256 },
  GAS_STATION: { kind: 'asphalt', tint: 0xffffff, tile: 256 },
  HIGH_VALUE: { kind: 'metal', tint: 0xb9a38a, tile: 120 },
};

export const FLOOR_GROUND: Record<FloorPatch['style'], { kind: GroundKind; tint: number; tile: number; y: number }> = {
  road: { kind: 'asphalt', tint: 0xffffff, tile: 256, y: 1.2 },
  concrete: { kind: 'concrete', tint: 0xd2d6dc, tile: 256, y: 1.4 },
  dock: { kind: 'planks', tint: 0xb9aa98, tile: 220, y: 1.0 },
  interior: { kind: 'tiles', tint: 0xd9dde3, tile: 120, y: 2.0 },
  vault_floor: { kind: 'metal', tint: 0xc9a979, tile: 110, y: 2.0 },
  water: { kind: 'asphalt', tint: 0x2a5170, tile: 256, y: 0.8 },
};

export const CRATE_STYLE: Record<ContainerType, { color: number; trim: number; glow: number | null; size: number }> = {
  NORMAL: { color: 0xb08850, trim: 0x3a2a18, glow: null, size: 42 },
  MILITARY: { color: 0x6b7f4a, trim: 0x22281a, glow: null, size: 44 },
  RARE: { color: 0x3d6bc4, trim: 0x16254a, glow: 0x60a5fa, size: 44 },
  LEGENDARY: { color: 0x2b2b30, trim: 0xf5b301, glow: 0xf5b301, size: 46 },
  SUPPLY_DROP: { color: 0xe8590c, trim: 0x2a1406, glow: 0xfb923c, size: 58 },
};
