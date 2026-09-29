import type { Cents } from './common';

export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const;
export type Rarity = (typeof RARITIES)[number];

export const ITEM_TYPES = ['WEAPON', 'AMMO', 'CONSUMABLE', 'VALUABLE', 'COSMETIC'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const AMMO_TYPES = ['light', 'rifle', 'shell', 'heavy'] as const;
export type AmmoType = (typeof AMMO_TYPES)[number];

export type ItemId = string;

export interface ItemMetadata {
  description?: string;
  /** Weapon items link to a WeaponDefinition. */
  weaponId?: string;
  /** Ammo items add to this reserve. */
  ammoType?: AmmoType;
  /** Consumables. */
  heal?: number;
  armor?: number;
  useTimeMs?: number;
  /** Starter gear is never dropped, valued or persisted. */
  starter?: boolean;
  /** Limited (season) items get serial numbers on persistence. */
  limited?: boolean;
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  type: ItemType;
  rarity: Rarity;
  stackable: boolean;
  maxStack: number;
  /** Estimated value in cents of TEST USDC. */
  estimatedValue: Cents;
  /** Asset key; the client maps it to a sprite/glyph. */
  icon: string;
  metadata: ItemMetadata;
  /** Whether the item is stored in the account inventory after extraction. */
  persistable: boolean;
  /** Relative weight inside its rarity bucket when rolling loot. 0 = never rolled. */
  dropWeight: number;
  /** Quantity range per drop (inclusive). */
  dropQuantity: readonly [number, number];
  seasonId: string | null;
  maxSupply: number | null;
}

/** A stack of items living in a raid inventory slot or on the ground. */
export interface ItemStack {
  uid: string;
  itemId: ItemId;
  qty: number;
}
