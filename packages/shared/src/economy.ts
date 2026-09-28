import { ECONOMY_CONFIG, getItemDef } from '@extract/game-config';
import type { ItemStack, Rarity, WeaponInstance } from '@extract/game-types';

export interface FeeBreakdown {
  priceCents: number;
  feeCents: number;
  sellerProceedsCents: number;
}

/**
 * Marketplace fee. Integer cents; the fee is rounded down so the seller never
 * receives less than (100% - fee%) of the price. $100.00 @ 5 % -> $5.00 fee, $95.00 to seller.
 */
export function calculateMarketplaceFee(
  priceCents: number,
  feeBps: number = ECONOMY_CONFIG.marketplace.feeBps,
): FeeBreakdown {
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error('priceCents must be a non-negative integer');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new Error('feeBps must be 0..10000');
  const feeCents = Math.floor((priceCents * feeBps) / 10_000);
  return { priceCents, feeCents, sellerProceedsCents: priceCents - feeCents };
}

/**
 * Bounty for a player with `kills` kills. 0 below the threshold, then the
 * configured table (5, 6, 7, 8 kills), then geometric growth.
 */
export function calculateBounty(kills: number, cfg: typeof ECONOMY_CONFIG.bounty = ECONOMY_CONFIG.bounty): number {
  if (kills < cfg.thresholdKills) return 0;
  const idx = kills - cfg.thresholdKills;
  const table = cfg.tableCents;
  if (idx < table.length) return table[idx] as number;
  const last = table[table.length - 1] as number;
  return Math.round(last * Math.pow(cfg.growthMultiplier, idx - (table.length - 1)));
}

export function stackValue(stack: Pick<ItemStack, 'itemId' | 'qty'> | null | undefined): number {
  if (!stack) return 0;
  return getItemDef(stack.itemId).estimatedValue * stack.qty;
}

export function weaponValue(w: WeaponInstance | null | undefined): number {
  if (!w) return 0;
  const def = getItemDef(w.itemId);
  return def.metadata.starter ? 0 : def.estimatedValue;
}

export interface ItemSummary {
  valueCents: number;
  /** Units per rarity. */
  rarityCounts: Partial<Record<Rarity, number>>;
  units: number;
}

/** Deterministic value + rarity breakdown of a list of item amounts (configured estimated values). */
export function summarizeItems(items: readonly Pick<ItemStack, 'itemId' | 'qty'>[]): ItemSummary {
  const rarityCounts: Partial<Record<Rarity, number>> = {};
  let valueCents = 0;
  let units = 0;
  for (const i of items) {
    if (i.qty <= 0) continue;
    const def = getItemDef(i.itemId);
    if (def.metadata.starter) continue;
    valueCents += def.estimatedValue * i.qty;
    units += i.qty;
    rarityCounts[def.rarity] = (rarityCounts[def.rarity] ?? 0) + i.qty;
  }
  return { valueCents, rarityCounts, units };
}

/** Value of everything a player carries (bag + secure slot + non-starter weapons). */
export function carriedValue(
  slots: readonly (ItemStack | null)[],
  secure: ItemStack | null,
  weapons: readonly (WeaponInstance | null)[],
): number {
  let v = stackValue(secure);
  for (const s of slots) v += stackValue(s);
  for (const w of weapons) v += weaponValue(w);
  return v;
}
