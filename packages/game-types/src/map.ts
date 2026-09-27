import type { Vec2 } from './common';
import type { ContainerType } from './loot';

export const ZONE_TYPES = ['CITY', 'FACTORY', 'FOREST', 'PORT', 'GAS_STATION', 'HIGH_VALUE', 'OPEN'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export interface MapZone {
  id: string;
  type: ZoneType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ObstacleStyle =
  | 'wall'
  | 'container'
  | 'tree'
  | 'rock'
  | 'machine'
  | 'pump'
  | 'vault'
  | 'crate_stack';

export interface RectObstacle {
  kind: 'rect';
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  style: ObstacleStyle;
  /** Optional tint index for containers etc. */
  tint?: number;
}

export interface CircleObstacle {
  kind: 'circle';
  id: number;
  x: number;
  y: number;
  r: number;
  style: ObstacleStyle;
}

export type Obstacle = RectObstacle | CircleObstacle;

/** Visual-only floor areas (building interiors, roads, water, gas station apron). */
export interface FloorPatch {
  x: number;
  y: number;
  w: number;
  h: number;
  style: 'road' | 'interior' | 'concrete' | 'water' | 'dock' | 'vault_floor';
}

export interface CrateSpawn {
  x: number;
  y: number;
  type: ContainerType;
  zone: ZoneType;
  /** HIGH VALUE crates stay locked until the combat phase. */
  locked: boolean;
}

export interface ExtractionPointDef {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
}

export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  zones: MapZone[];
  floors: FloorPatch[];
  obstacles: Obstacle[];
  crates: CrateSpawn[];
  extractionPoints: ExtractionPointDef[];
  spawnPoints: Vec2[];
}
