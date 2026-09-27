import type { ItemId, ItemType, Rarity } from './items';

export const CONTAINER_TYPES = ['NORMAL', 'MILITARY', 'RARE', 'LEGENDARY', 'SUPPLY_DROP'] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export type RarityWeights = Record<Rarity, number>;

export interface GuaranteedDrop {
  itemId: ItemId;
  qty: readonly [number, number];
  /** 0..1 */
  chance: number;
}

export interface LootTableDefinition {
  id: ContainerType;
  label: string;
  /** Number of random rolls (inclusive range). */
  rolls: readonly [number, number];
  /** Multiplies the global base rarity weights. Missing = 1. */
  rarityMultipliers: Partial<Record<Rarity, number>>;
  /** Weight per item type inside a rarity bucket. */
  typeWeights: Record<ItemType, number>;
  guaranteed: readonly GuaranteedDrop[];
}

/** Spec alias. */
export type LootDefinition = LootTableDefinition;

export interface LootDrop {
  itemId: ItemId;
  qty: number;
  rarity: Rarity;
}
