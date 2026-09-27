import type { ContainerType, MapZone } from '@extract/game-types';

/**
 * Layout of the first map. Geometry inside each zone is generated
 * deterministically from `seed` by @extract/shared `generateMap`, so the
 * server and every client build exactly the same collision world.
 */
export const MAP_CONFIG = {
  id: 'genesis_isle',
  name: 'Genesis Isle',
  seed: 20260927,
  width: 4000,
  height: 4000,
  /** Solid border thickness. */
  border: 40,
  zones: [
    { id: 'city', type: 'CITY', name: 'City', x: 80, y: 80, w: 1520, h: 1520 },
    { id: 'factory', type: 'FACTORY', name: 'Factory', x: 2400, y: 80, w: 1520, h: 1520 },
    { id: 'forest', type: 'FOREST', name: 'Forest', x: 80, y: 2400, w: 1520, h: 1520 },
    { id: 'port', type: 'PORT', name: 'Port', x: 2400, y: 2400, w: 1520, h: 1520 },
    { id: 'gas', type: 'GAS_STATION', name: 'Gas Station', x: 1720, y: 260, w: 560, h: 460 },
    { id: 'vault', type: 'HIGH_VALUE', name: 'The Vault', x: 1700, y: 1700, w: 600, h: 600 },
  ] satisfies MapZone[],
  extractionPoints: [
    { id: 'ex_nw', name: 'Rooftop Heli', x: 240, y: 240 },
    { id: 'ex_ne', name: 'Freight Elevator', x: 3760, y: 240 },
    { id: 'ex_sw', name: 'Forest Trail', x: 240, y: 3760 },
    { id: 'ex_se', name: 'Harbor Boat', x: 3700, y: 3700 },
    { id: 'ex_w', name: 'West Tunnel', x: 180, y: 2000 },
    { id: 'ex_e', name: 'East Bridge', x: 3820, y: 2000 },
    { id: 'ex_s', name: 'South Road', x: 2000, y: 3820 },
  ],
  generation: {
    city: { gridCols: 4, gridRows: 4, lotPadding: 55, wallThickness: 14, doorWidth: 70 },
    factory: { halls: 4, machinesPerHall: 3, wallThickness: 16, doorWidth: 90 },
    forest: { trees: 150, rocks: 26, treeRadius: [24, 44] as const, rockRadius: [18, 30] as const },
    port: { containerRows: 6, containersPerRow: 7, containerSize: [150, 56] as const },
    vault: { wallThickness: 22, gateWidth: 110 },
    openField: { trees: 45, rocks: 30 },
  },
  crates: {
    CITY: { NORMAL: 26, MILITARY: 3, RARE: 5 },
    FACTORY: { NORMAL: 14, MILITARY: 10, RARE: 5 },
    FOREST: { NORMAL: 18, MILITARY: 4, RARE: 3 },
    PORT: { NORMAL: 16, MILITARY: 8, RARE: 5 },
    GAS_STATION: { NORMAL: 6, MILITARY: 1, RARE: 2 },
    HIGH_VALUE: { NORMAL: 0, MILITARY: 3, RARE: 4, LEGENDARY: 5 },
    OPEN: { NORMAL: 16, MILITARY: 2, RARE: 1 },
  } satisfies Record<string, Partial<Record<ContainerType, number>>>,
  spawnPointCount: 140,
} as const;
