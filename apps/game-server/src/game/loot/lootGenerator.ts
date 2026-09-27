import {
  BASE_RARITY_WEIGHTS,
  ITEM_DEFINITIONS,
  LOOT_TABLES,
  ZONE_LOOT_MULTIPLIERS,
} from '@extract/game-config';
import {
  RARITIES,
  type ContainerType,
  type ItemDefinition,
  type ItemId,
  type LootDrop,
  type LootTableDefinition,
  type Rarity,
  type RarityWeights,
  type ZoneType,
} from '@extract/game-types';
import type { Rng } from '@extract/shared';

/** Tracks remaining supply of limited items during a match. */
export interface LimitedSupply {
  canDrop(itemId: ItemId): boolean;
  reserve(itemId: ItemId): void;
}

export class LimitedSupplyTracker implements LimitedSupply {
  constructor(private readonly remaining: Record<ItemId, number> = {}) {}

  canDrop(itemId: ItemId): boolean {
    const r = this.remaining[itemId];
    return r === undefined || r > 0;
  }

  reserve(itemId: ItemId): void {
    const r = this.remaining[itemId];
    if (r !== undefined) this.remaining[itemId] = Math.max(0, r - 1);
  }

  /** Limited items whose supply is unknown are treated as unavailable. */
  static fromDefinitions(known: Record<ItemId, number>): LimitedSupplyTracker {
    const remaining: Record<ItemId, number> = {};
    for (const def of ITEM_DEFINITIONS) {
      if (def.maxSupply !== null) remaining[def.id] = known[def.id] ?? 0;
    }
    return new LimitedSupplyTracker(remaining);
  }
}

export interface LootContext {
  rng: Rng;
  zone: ZoneType;
  supply: LimitedSupply;
}

export function effectiveRarityWeights(table: LootTableDefinition, zone: ZoneType): RarityWeights {
  const zoneMul = ZONE_LOOT_MULTIPLIERS[zone];
  const out = { ...BASE_RARITY_WEIGHTS };
  for (const r of RARITIES) out[r] = BASE_RARITY_WEIGHTS[r] * (table.rarityMultipliers[r] ?? 1) * (zoneMul[r] ?? 1);
  return out;
}

export function rollRarity(rng: Rng, weights: RarityWeights): Rarity {
  return rng.weighted(RARITIES, (r) => weights[r]) ?? 'COMMON';
}

function candidates(rarity: Rarity, table: LootTableDefinition, supply: LimitedSupply): ItemDefinition[] {
  return ITEM_DEFINITIONS.filter(
    (d) => d.rarity === rarity && d.dropWeight > 0 && table.typeWeights[d.type] > 0 && supply.canDrop(d.id),
  );
}

/** Picks an item of the rolled rarity; downgrades the rarity when the bucket is empty. */
export function pickItem(rng: Rng, rarity: Rarity, table: LootTableDefinition, supply: LimitedSupply): ItemDefinition | null {
  for (let idx = RARITIES.indexOf(rarity); idx >= 0; idx--) {
    const pool = candidates(RARITIES[idx] as Rarity, table, supply);
    const pick = rng.weighted(pool, (d) => d.dropWeight * table.typeWeights[d.type]);
    if (pick) return pick;
  }
  return null;
}

function quantity(rng: Rng, def: ItemDefinition): number {
  const [min, max] = def.dropQuantity;
  return rng.int(min, max);
}

/** Server-side loot roll for one container. Pure given the RNG. */
export function rollContainerLoot(type: ContainerType, ctx: LootContext): LootDrop[] {
  const table = LOOT_TABLES[type];
  const weights = effectiveRarityWeights(table, ctx.zone);
  const drops: LootDrop[] = [];

  for (const g of table.guaranteed) {
    if (!ctx.rng.chance(g.chance)) continue;
    const def = ITEM_DEFINITIONS.find((d) => d.id === g.itemId);
    if (!def || !ctx.supply.canDrop(def.id)) continue;
    drops.push({ itemId: def.id, qty: ctx.rng.int(g.qty[0], g.qty[1]), rarity: def.rarity });
  }

  const rolls = ctx.rng.int(table.rolls[0], table.rolls[1]);
  for (let i = 0; i < rolls; i++) {
    const def = pickItem(ctx.rng, rollRarity(ctx.rng, weights), table, ctx.supply);
    if (!def) continue;
    if (def.maxSupply !== null) ctx.supply.reserve(def.id);
    drops.push({ itemId: def.id, qty: quantity(ctx.rng, def), rarity: def.rarity });
  }
  return drops;
}
