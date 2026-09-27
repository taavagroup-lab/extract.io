import type { AmmoType, ItemId } from './items';

export const WEAPON_IDS = ['basic_pistol', 'smg', 'assault_rifle', 'shotgun'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export interface DamageFalloff {
  /** Full damage up to this distance. */
  startRange: number;
  /** Minimum multiplier reached at this distance. */
  endRange: number;
  minMultiplier: number;
}

export interface WeaponDefinition {
  id: WeaponId;
  itemId: ItemId;
  name: string;
  /** Damage per bullet / pellet. */
  damage: number;
  fireIntervalMs: number;
  magazineSize: number;
  reloadMs: number;
  bulletSpeed: number;
  range: number;
  /** Max random deviation in radians (each side). */
  spread: number;
  pellets: number;
  ammoType: AmmoType;
  falloff: DamageFalloff;
  /** Visual hints for the client. */
  bulletColor: number;
  barrelLength: number;
}

export interface WeaponInstance {
  uid: string;
  itemId: ItemId;
  weaponId: WeaponId;
  /** Rounds currently in the magazine. */
  mag: number;
}
