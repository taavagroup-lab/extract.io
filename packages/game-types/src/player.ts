import type { Cents, EntityId, Vec2 } from './common';
import type { AmmoType, ItemId, ItemStack } from './items';
import type { WeaponInstance } from './weapons';

export const PLAYER_STATUSES = ['ALIVE', 'DOWNED', 'DEAD', 'EXTRACTING', 'EXTRACTED', 'DISCONNECTED'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

export type AmmoReserves = Record<AmmoType, number>;

export interface InventoryState {
  slots: (ItemStack | null)[];
  secure: ItemStack | null;
}

/**
 * Authoritative character state (server). Mirrors the spec field list; the
 * server entity class implements it and the network layer projects it.
 */
export interface PlayerState {
  id: EntityId;
  userId: string | null;
  name: string;
  isBot: boolean;
  status: PlayerStatus;
  position: Vec2;
  rotation: number;
  health: number;
  maxHealth: number;
  armor: number;
  movementSpeed: number;
  dashCooldown: number;
  inventory: InventoryState;
  weapons: (WeaponInstance | null)[];
  equippedWeapon: WeaponInstance | null;
  ammo: AmmoReserves;
  kills: number;
  extractedLootValue: Cents;
  currentBagValue: Cents;
}

export interface ExtractionProgress {
  zoneId: string;
  /** 0..1 */
  progress: number;
  remainingMs: number;
}

export interface ItemUseProgress {
  itemId: ItemId;
  remainingMs: number;
  totalMs: number;
}

/** Private state sent only to the owning client with every snapshot. */
export interface SelfState {
  id: EntityId;
  x: number;
  y: number;
  /** Movement prediction state (seconds). */
  dashTime: number;
  dashCooldown: number;
  dashDirX: number;
  dashDirY: number;
  hp: number;
  maxHp: number;
  armor: number;
  status: PlayerStatus;
  activeSlot: number;
  weapons: (WeaponInstance | null)[];
  ammo: AmmoReserves;
  reloadRemainingMs: number;
  reloadTotalMs: number;
  useItem: ItemUseProgress | null;
  kills: number;
  damageDealt: number;
  bagValue: Cents;
  /** Bounty on this player's head (0 unless HIGH VALUE TARGET). */
  bountyCents: Cents;
  /** Bounties collected this raid; paid out on extraction. */
  pendingBountyCents: Cents;
  extraction: ExtractionProgress | null;
}

export interface ItemAmount {
  itemId: ItemId;
  qty: number;
}

export type RunEndReason = 'killed' | 'timeout' | 'abandoned';

export interface DeathSummary {
  reason: RunEndReason;
  killerName: string | null;
  killerId: EntityId | null;
  weaponName: string | null;
  kills: number;
  damageDealt: number;
  survivedMs: number;
  lootSecuredCents: Cents;
  lootLostCents: Cents;
  /** Part of the secured value paid out as TEST USDC when items could not be split. */
  insuranceCents: Cents;
  keptItems: ItemAmount[];
  lostItems: ItemAmount[];
  bountyLostCents: Cents;
}

export interface ExtractionSummary {
  extractionPoint: string;
  items: ItemAmount[];
  valueCents: Cents;
  kills: number;
  damageDealt: number;
  survivedMs: number;
  bountyEarnedCents: Cents;
}
