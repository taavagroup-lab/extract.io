import { ECONOMY_CONFIG, getItemDef } from '@extract/game-config';
import type { AmmoReserves, ItemAmount, ItemId, ItemStack, WeaponInstance } from '@extract/game-types';
import type { Rng } from '@extract/shared';

export interface RunInventorySnapshot {
  slots: readonly (ItemStack | null)[];
  secure: ItemStack | null;
  weapons: readonly (WeaponInstance | null)[];
  ammo: AmmoReserves;
}

export interface DroppedWeapon {
  itemId: ItemId;
  mag: number;
}

export interface RunLossOutcome {
  /** Items the player keeps (secure slot + auto-secured), merged by item id. */
  kept: ItemAmount[];
  /** Bag items dropped on the ground. */
  droppedItems: ItemAmount[];
  droppedWeapons: DroppedWeapon[];
  droppedAmmo: ItemAmount[];
  secureSlotValue: number;
  autoSecuredItemValue: number;
  /** TEST USDC paid out to reach the auto-secure target. */
  insuranceCents: number;
  /** Value of all valuables outside the secure slot. */
  atRiskValue: number;
  /** Displayed "Loot Secured". */
  securedValue: number;
  /** Displayed "Loot Lost". */
  lostValue: number;
}

export interface RunLossOptions {
  /** Fraction of the at-risk value that is secured (0 on timeout). */
  autoSecureRatio: number;
  insurancePayout: boolean;
}

interface Unit {
  itemId: ItemId;
  value: number;
  weapon?: DroppedWeapon;
}

const AMMO_ITEM: Record<keyof AmmoReserves, ItemId> = { light: 'ammo_light', rifle: 'ammo_rifle', shell: 'ammo_shell', heavy: 'ammo_heavy' };

function merge(units: { itemId: ItemId }[]): ItemAmount[] {
  const m = new Map<ItemId, number>();
  for (const u of units) m.set(u.itemId, (m.get(u.itemId) ?? 0) + 1);
  return [...m.entries()].map(([itemId, qty]) => ({ itemId, qty }));
}

/**
 * Splits a lost run (death / abandon / timeout) into kept and dropped loot.
 *
 * - The secure slot is always kept.
 * - Everything else is broken into single units and shuffled; units are
 *   auto-secured while they fit into `autoSecureRatio` of the at-risk value.
 * - The unreachable remainder of the target is paid as insurance (optional).
 * - All remaining units (~70 %) drop; ammo drops; the starter pistol vanishes.
 */
export function computeRunLoss(inv: RunInventorySnapshot, opts: RunLossOptions, rng: Rng): RunLossOutcome {
  const units: Unit[] = [];
  const worthless: Unit[] = [];
  for (const s of inv.slots) {
    if (!s) continue;
    const def = getItemDef(s.itemId);
    for (let i = 0; i < s.qty; i++) {
      const u = { itemId: s.itemId, value: def.estimatedValue };
      (def.persistable && def.estimatedValue > 0 ? units : worthless).push(u);
    }
  }
  for (const w of inv.weapons) {
    if (!w) continue;
    const def = getItemDef(w.itemId);
    if (def.metadata.starter) continue;
    units.push({ itemId: w.itemId, value: def.estimatedValue, weapon: { itemId: w.itemId, mag: w.mag } });
  }

  const atRiskValue = units.reduce((n, u) => n + u.value, 0);
  const target = Math.floor(atRiskValue * Math.max(0, Math.min(1, opts.autoSecureRatio)));

  rng.shuffle(units);
  const secured: Unit[] = [];
  const dropped: Unit[] = [];
  let securedValue = 0;
  for (const u of units) {
    if (securedValue + u.value <= target && target > 0) {
      secured.push(u);
      securedValue += u.value;
    } else {
      dropped.push(u);
    }
  }
  const insuranceCents = opts.insurancePayout ? target - securedValue : 0;

  const secureSlotValue = inv.secure ? getItemDef(inv.secure.itemId).estimatedValue * inv.secure.qty : 0;
  const keptUnits: { itemId: ItemId }[] = secured.map((u) => ({ itemId: u.itemId }));
  const kept = merge(keptUnits);
  if (inv.secure && getItemDef(inv.secure.itemId).persistable) {
    const existing = kept.find((k) => k.itemId === inv.secure!.itemId);
    if (existing) existing.qty += inv.secure.qty;
    else kept.push({ itemId: inv.secure.itemId, qty: inv.secure.qty });
  }

  const droppedAmmo: ItemAmount[] = [];
  for (const [type, qty] of Object.entries(inv.ammo) as [keyof AmmoReserves, number][]) {
    if (qty > 0) droppedAmmo.push({ itemId: AMMO_ITEM[type], qty });
  }
  // Worthless bag items (e.g. ammo stored as items) drop too.
  const droppedItems = merge([...dropped.filter((u) => !u.weapon), ...worthless]);

  return {
    kept,
    droppedItems,
    droppedWeapons: dropped.filter((u) => u.weapon).map((u) => u.weapon!),
    droppedAmmo,
    secureSlotValue,
    autoSecuredItemValue: securedValue,
    insuranceCents,
    atRiskValue,
    securedValue: secureSlotValue + securedValue + insuranceCents,
    lostValue: atRiskValue - securedValue - insuranceCents,
  };
}

export const DEATH_LOSS_OPTIONS: RunLossOptions = {
  autoSecureRatio: ECONOMY_CONFIG.death.autoSecureRatio,
  insurancePayout: ECONOMY_CONFIG.death.insurancePayout,
};

export const TIMEOUT_LOSS_OPTIONS: RunLossOptions = ECONOMY_CONFIG.timeoutKeepsAutoSecure
  ? DEATH_LOSS_OPTIONS
  : { autoSecureRatio: 0, insurancePayout: false };
