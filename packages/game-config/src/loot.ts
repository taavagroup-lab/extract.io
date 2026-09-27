import type {
  ContainerType,
  ItemType,
  LootTableDefinition,
  Rarity,
  RarityWeights,
  ZoneType,
} from '@extract/game-types';

/**
 * Central loot configuration ("lootConfig").
 * Base drop chances per rarity. Weights are relative; they sum to 100 here
 * so they read as percentages.
 */
export const RARITY_CONFIG: Record<
  Rarity,
  { label: string; color: string; colorHex: number; weight: number; rank: number }
> = {
  COMMON: { label: 'Common', color: '#9ca3af', colorHex: 0x9ca3af, weight: 70, rank: 0 },
  RARE: { label: 'Rare', color: '#3b82f6', colorHex: 0x3b82f6, weight: 20, rank: 1 },
  EPIC: { label: 'Epic', color: '#a855f7', colorHex: 0xa855f7, weight: 8, rank: 2 },
  LEGENDARY: { label: 'Legendary', color: '#f5b301', colorHex: 0xf5b301, weight: 1.9, rank: 3 },
  MYTHIC: { label: 'Mythic', color: '#ef4444', colorHex: 0xef4444, weight: 0.1, rank: 4 },
};

export const BASE_RARITY_WEIGHTS: RarityWeights = {
  COMMON: RARITY_CONFIG.COMMON.weight,
  RARE: RARITY_CONFIG.RARE.weight,
  EPIC: RARITY_CONFIG.EPIC.weight,
  LEGENDARY: RARITY_CONFIG.LEGENDARY.weight,
  MYTHIC: RARITY_CONFIG.MYTHIC.weight,
};

/** Items at or above this rarity trigger the "valuable loot" toast and a log event. */
export const LOOT_TOAST_MIN_RARITY: Rarity = 'RARE';
export const LEGENDARY_LOG_MIN_RARITY: Rarity = 'LEGENDARY';

const ALL_TYPES: Record<ItemType, number> = {
  WEAPON: 1,
  AMMO: 1,
  CONSUMABLE: 1,
  VALUABLE: 1,
  COSMETIC: 1,
};

export const LOOT_TABLES: Record<ContainerType, LootTableDefinition> = {
  NORMAL: {
    id: 'NORMAL',
    label: 'Crate',
    rolls: [2, 3],
    rarityMultipliers: {},
    typeWeights: { ...ALL_TYPES, AMMO: 1.4, CONSUMABLE: 1.2 },
    guaranteed: [],
  },
  MILITARY: {
    id: 'MILITARY',
    label: 'Military Crate',
    rolls: [2, 4],
    rarityMultipliers: { RARE: 1.6, EPIC: 1.6 },
    typeWeights: { WEAPON: 3, AMMO: 3, CONSUMABLE: 1.5, VALUABLE: 0.5, COSMETIC: 0.5 },
    guaranteed: [
      { itemId: 'ammo_light', qty: [20, 40], chance: 0.6 },
      { itemId: 'ammo_rifle', qty: [15, 30], chance: 0.4 },
      { itemId: 'ammo_shell', qty: [6, 12], chance: 0.3 },
    ],
  },
  RARE: {
    id: 'RARE',
    label: 'Rare Crate',
    rolls: [2, 3],
    rarityMultipliers: { COMMON: 0.4, RARE: 2, EPIC: 2.2, LEGENDARY: 2.5, MYTHIC: 2 },
    typeWeights: { ...ALL_TYPES, AMMO: 0.6 },
    guaranteed: [],
  },
  LEGENDARY: {
    id: 'LEGENDARY',
    label: 'Legendary Crate',
    rolls: [3, 4],
    rarityMultipliers: { COMMON: 0.15, RARE: 1.5, EPIC: 3, LEGENDARY: 6, MYTHIC: 5 },
    typeWeights: { ...ALL_TYPES, AMMO: 0.3 },
    guaranteed: [{ itemId: 'armor_plate', qty: [1, 2], chance: 0.7 }],
  },
  SUPPLY_DROP: {
    id: 'SUPPLY_DROP',
    label: 'Supply Drop',
    rolls: [4, 6],
    rarityMultipliers: { COMMON: 0.1, RARE: 1.5, EPIC: 4, LEGENDARY: 8, MYTHIC: 6 },
    typeWeights: { WEAPON: 2, AMMO: 0.5, CONSUMABLE: 1.5, VALUABLE: 1.5, COSMETIC: 1.5 },
    guaranteed: [
      { itemId: 'assault_rifle', qty: [1, 1], chance: 0.6 },
      { itemId: 'armor_plate', qty: [2, 3], chance: 1 },
      { itemId: 'medkit', qty: [1, 2], chance: 1 },
      { itemId: 'ammo_rifle', qty: [30, 50], chance: 1 },
    ],
  },
};

/** Extra rarity multipliers applied to crates depending on the zone they are in. */
export const ZONE_LOOT_MULTIPLIERS: Record<ZoneType, Partial<Record<Rarity, number>>> = {
  CITY: {},
  FACTORY: { RARE: 1.15 },
  FOREST: { COMMON: 1.1 },
  PORT: { RARE: 1.1, EPIC: 1.1 },
  GAS_STATION: {},
  HIGH_VALUE: { EPIC: 1.5, LEGENDARY: 2, MYTHIC: 2 },
  OPEN: {},
};

/** Scatter radius when a container spills its loot. */
export const LOOT_SPILL_RADIUS = 46;
/** Scatter radius for items dropped on death. */
export const DEATH_SPILL_RADIUS = 70;
