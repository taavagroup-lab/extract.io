import type { ItemDefinition, ItemId, WeaponId } from '@extract/game-types';
import { WEAPONS } from './weapons';
import { SEASON_1 } from './season';

type ItemInput = Omit<ItemDefinition, 'seasonId' | 'maxSupply' | 'metadata'> &
  Partial<Pick<ItemDefinition, 'seasonId' | 'maxSupply' | 'metadata'>>;

const item = (def: ItemInput): ItemDefinition => ({
  seasonId: null,
  maxSupply: null,
  metadata: {},
  ...def,
});

/** Weapon item: identity and rarity come from the weapon definition. */
function weaponItem(id: WeaponId, o: { value: number; icon: string; dropWeight: number; starter?: boolean }): ItemDefinition {
  const w = WEAPONS[id];
  return item({
    id,
    name: w.name,
    type: 'WEAPON',
    rarity: w.rarity,
    stackable: false,
    maxStack: 1,
    estimatedValue: o.value,
    icon: o.icon,
    persistable: !o.starter,
    dropWeight: o.dropWeight,
    dropQuantity: [1, 1],
    metadata: { weaponId: id, description: w.description, ...(o.starter ? { starter: true } : {}) },
  });
}

/**
 * Item catalog. Values are integer cents of TEST USDC.
 * This file is the source of truth; `pnpm db:seed` mirrors it into ItemDefinition.
 */
export const ITEM_DEFINITIONS: readonly ItemDefinition[] = [
  // --- Weapons (stats live in weapons.ts; name / rarity / description come from there) ---
  weaponItem('basic_pistol', { value: 0, icon: 'pistol', dropWeight: 0, starter: true }),
  weaponItem('heavy_pistol', { value: 220, icon: 'pistol_heavy', dropWeight: 2.5 }),
  weaponItem('smg', { value: 250, icon: 'smg', dropWeight: 5 }),
  weaponItem('suppressed_smg', { value: 380, icon: 'smg_sd', dropWeight: 2.5 }),
  weaponItem('shotgun', { value: 300, icon: 'shotgun', dropWeight: 4 }),
  weaponItem('assault_rifle', { value: 600, icon: 'rifle', dropWeight: 3 }),
  weaponItem('burst_rifle', { value: 650, icon: 'rifle_burst', dropWeight: 1.5 }),
  weaponItem('battle_rifle', { value: 700, icon: 'rifle_battle', dropWeight: 1.5 }),
  weaponItem('auto_shotgun', { value: 560, icon: 'shotgun_auto', dropWeight: 1.5 }),
  weaponItem('marksman_rifle', { value: 850, icon: 'sniper', dropWeight: 1.2 }),
  weaponItem('lmg', { value: 780, icon: 'lmg', dropWeight: 1.3 }),
  weaponItem('void_rifle', { value: 4285, icon: 'void_rifle', dropWeight: 1.2 }),
  // --- Ammo ----------------------------------------------------------------
  item({
    id: 'ammo_light',
    name: 'Light Ammo',
    type: 'AMMO',
    rarity: 'COMMON',
    stackable: true,
    maxStack: 240,
    estimatedValue: 0,
    icon: 'ammo_light',
    persistable: false,
    dropWeight: 6,
    dropQuantity: [18, 36],
    metadata: { ammoType: 'light', description: 'Pistol & SMG ammunition.' },
  }),
  item({
    id: 'ammo_rifle',
    name: 'Rifle Ammo',
    type: 'AMMO',
    rarity: 'COMMON',
    stackable: true,
    maxStack: 200,
    estimatedValue: 0,
    icon: 'ammo_rifle',
    persistable: false,
    dropWeight: 4,
    dropQuantity: [15, 30],
    metadata: { ammoType: 'rifle', description: 'Assault, burst, LMG and void rifle ammunition.' },
  }),
  item({
    id: 'ammo_shell',
    name: 'Shotgun Shells',
    type: 'AMMO',
    rarity: 'COMMON',
    stackable: true,
    maxStack: 60,
    estimatedValue: 0,
    icon: 'ammo_shell',
    persistable: false,
    dropWeight: 3,
    dropQuantity: [6, 12],
    metadata: { ammoType: 'shell', description: 'Shotgun shells.' },
  }),
  item({
    id: 'ammo_heavy',
    name: 'Heavy Ammo',
    type: 'AMMO',
    rarity: 'COMMON',
    stackable: true,
    maxStack: 60,
    estimatedValue: 0,
    icon: 'ammo_heavy',
    persistable: false,
    dropWeight: 2,
    dropQuantity: [6, 14],
    metadata: { ammoType: 'heavy', description: 'Full-power rounds: heavy pistol, battle rifle, sniper.' },
  }),
  // --- Consumables ---------------------------------------------------------
  item({
    id: 'medkit',
    name: 'Medkit',
    type: 'CONSUMABLE',
    rarity: 'COMMON',
    stackable: true,
    maxStack: 5,
    estimatedValue: 40,
    icon: 'medkit',
    persistable: true,
    dropWeight: 5,
    dropQuantity: [1, 2],
    metadata: { heal: 50, useTimeMs: 1500, description: 'Restores 50 health.' },
  }),
  item({
    id: 'armor_plate',
    name: 'Armor Plate',
    type: 'CONSUMABLE',
    rarity: 'RARE',
    stackable: true,
    maxStack: 5,
    estimatedValue: 90,
    icon: 'armor',
    persistable: true,
    dropWeight: 6,
    dropQuantity: [1, 2],
    metadata: { armor: 25, useTimeMs: 1000, description: 'Adds 25 armor.' },
  }),
  // --- Valuables -----------------------------------------------------------
  item({
    id: 'scrap',
    name: 'Scrap',
    type: 'VALUABLE',
    rarity: 'COMMON',
    stackable: true,
    maxStack: 50,
    estimatedValue: 5,
    icon: 'scrap',
    persistable: true,
    dropWeight: 10,
    dropQuantity: [2, 6],
    metadata: { description: 'Bits of metal. Worth a little.' },
  }),
  item({
    id: 'copper_wire',
    name: 'Copper Wire',
    type: 'VALUABLE',
    rarity: 'COMMON',
    stackable: true,
    maxStack: 20,
    estimatedValue: 15,
    icon: 'wire',
    persistable: true,
    dropWeight: 6,
    dropQuantity: [1, 3],
    metadata: { description: 'Salvaged copper.' },
  }),
  item({
    id: 'circuit_board',
    name: 'Circuit Board',
    type: 'VALUABLE',
    rarity: 'RARE',
    stackable: true,
    maxStack: 10,
    estimatedValue: 120,
    icon: 'circuit',
    persistable: true,
    dropWeight: 5,
    dropQuantity: [1, 2],
    metadata: { description: 'Salvageable electronics.' },
  }),
  item({
    id: 'gold_bar',
    name: 'Gold Bar',
    type: 'VALUABLE',
    rarity: 'EPIC',
    stackable: true,
    maxStack: 3,
    estimatedValue: 650,
    icon: 'gold',
    persistable: true,
    dropWeight: 4,
    dropQuantity: [1, 1],
    metadata: { description: 'Heavy. Shiny. Valuable.' },
  }),
  item({
    id: 'quantum_core',
    name: 'Quantum Core',
    type: 'VALUABLE',
    rarity: 'LEGENDARY',
    stackable: false,
    maxStack: 1,
    estimatedValue: 3000,
    icon: 'core',
    persistable: true,
    dropWeight: 3,
    dropQuantity: [1, 1],
    metadata: { description: 'Experimental power core.' },
  }),
  // --- Cosmetics -----------------------------------------------------------
  item({
    id: 'rare_skin_fragment',
    name: 'Rare Skin Fragment',
    type: 'COSMETIC',
    rarity: 'RARE',
    stackable: true,
    maxStack: 10,
    estimatedValue: 150,
    icon: 'fragment',
    persistable: true,
    dropWeight: 4,
    dropQuantity: [1, 1],
    metadata: { description: 'Combine fragments into skins (future).' },
  }),
  item({
    id: 'epic_weapon_skin',
    name: 'Epic Weapon Skin',
    type: 'COSMETIC',
    rarity: 'EPIC',
    stackable: false,
    maxStack: 1,
    estimatedValue: 900,
    icon: 'skin',
    persistable: true,
    dropWeight: 3,
    dropQuantity: [1, 1],
    metadata: { description: 'Neon Viper weapon finish.' },
  }),
  item({
    id: 'cyber_katana',
    name: 'Cyber Katana',
    type: 'COSMETIC',
    rarity: 'LEGENDARY',
    stackable: false,
    maxStack: 1,
    estimatedValue: 4280,
    icon: 'katana',
    persistable: true,
    dropWeight: 2,
    dropQuantity: [1, 1],
    metadata: { description: 'Legendary katana cosmetic.' },
  }),
  item({
    id: 'genesis_crown',
    name: 'Genesis Crown',
    type: 'COSMETIC',
    rarity: 'MYTHIC',
    stackable: false,
    maxStack: 1,
    estimatedValue: 25000,
    icon: 'crown',
    persistable: true,
    dropWeight: 1,
    dropQuantity: [1, 1],
    seasonId: SEASON_1.id,
    maxSupply: SEASON_1.genesisCrownSupply,
    metadata: { limited: true, description: 'Season 1 limited edition. Serial numbered.' },
  }),
];

export const ITEMS: Readonly<Record<ItemId, ItemDefinition>> = Object.freeze(
  Object.fromEntries(ITEM_DEFINITIONS.map((d) => [d.id, d])),
);

export function getItemDef(id: ItemId): ItemDefinition {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item id: ${id}`);
  return def;
}

export function isItemId(id: unknown): id is ItemId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, id);
}

export const STARTER_WEAPON_ITEM = 'basic_pistol';
