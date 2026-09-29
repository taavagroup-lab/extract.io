import type { ContainerType, ItemId, WeaponId, ZoneType } from '@extract/game-types';

export interface GroundItem {
  id: number;
  x: number;
  y: number;
  itemId: ItemId;
  qty: number;
  /** Magazine content for dropped weapons. */
  mag?: number;
  spawnedAt: number;
}

export interface Crate {
  id: number;
  x: number;
  y: number;
  type: ContainerType;
  zone: ZoneType;
  opened: boolean;
  locked: boolean;
  /** Supply drop id when this crate came from a supply drop. */
  supplyDropId?: number;
}

export interface Bullet {
  id: number;
  ownerId: number;
  weaponId: WeaponId;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  remaining: number;
  traveled: number;
  damage: number;
  /** Players this round may still pass through. */
  pierce: number;
  /** Player just pierced (the next segment starts inside them). */
  ignoreId: number;
}
