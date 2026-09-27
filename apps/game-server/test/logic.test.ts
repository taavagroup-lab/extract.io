import { ECONOMY_CONFIG, ITEM_DEFINITIONS, LOOT_TABLES, PLAYER_CONFIG, RARITY_CONFIG } from '@extract/game-config';
import { RARITIES, type Rarity } from '@extract/game-types';
import { Rng } from '@extract/shared';
import { describe, expect, it } from 'vitest';
import { bulletDamage, computeDamage, falloffMultiplier } from '../src/game/combat/damage';
import { computeRunLoss, DEATH_LOSS_OPTIONS, TIMEOUT_LOSS_OPTIONS } from '../src/game/death/deathOutcome';
import { RaidInventory, createWeapon } from '../src/game/inventory/RaidInventory';
import {
  LimitedSupplyTracker,
  effectiveRarityWeights,
  pickItem,
  rollContainerLoot,
  rollRarity,
} from '../src/game/loot/lootGenerator';

describe('loot generation', () => {
  it('rolls rarities close to the configured base chances', () => {
    const rng = new Rng(7);
    const weights = effectiveRarityWeights(LOOT_TABLES.NORMAL, 'CITY');
    const counts: Record<Rarity, number> = { COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0, MYTHIC: 0 };
    const N = 200_000;
    for (let i = 0; i < N; i++) counts[rollRarity(rng, weights)]++;
    expect(counts.COMMON / N).toBeCloseTo(0.7, 1);
    expect(counts.RARE / N).toBeCloseTo(0.2, 1);
    expect(counts.EPIC / N).toBeCloseTo(0.08, 1);
    expect(counts.LEGENDARY / N).toBeGreaterThan(0.012);
    expect(counts.LEGENDARY / N).toBeLessThan(0.026);
    expect(counts.MYTHIC).toBeGreaterThan(0);
    expect(counts.MYTHIC / N).toBeLessThan(0.003);
  });

  it('legendary crates and the high value zone improve the odds', () => {
    const normal = effectiveRarityWeights(LOOT_TABLES.NORMAL, 'CITY');
    const vault = effectiveRarityWeights(LOOT_TABLES.LEGENDARY, 'HIGH_VALUE');
    const share = (w: Record<Rarity, number>) => w.LEGENDARY / RARITIES.reduce((n, r) => n + w[r], 0);
    expect(share(vault)).toBeGreaterThan(share(normal) * 10);
  });

  it('always produces valid items within stack limits', () => {
    const rng = new Rng(99);
    const supply = LimitedSupplyTracker.fromDefinitions({ genesis_crown: 1000 });
    for (let i = 0; i < 2000; i++) {
      for (const drop of rollContainerLoot('SUPPLY_DROP', { rng, zone: 'OPEN', supply })) {
        const def = ITEM_DEFINITIONS.find((d) => d.id === drop.itemId)!;
        expect(def).toBeDefined();
        expect(drop.qty).toBeGreaterThan(0);
        expect(drop.rarity).toBe(def.rarity);
      }
    }
  });

  it('never drops limited items once the supply is exhausted', () => {
    const rng = new Rng(1);
    const supply = LimitedSupplyTracker.fromDefinitions({ genesis_crown: 0 });
    for (let i = 0; i < 500; i++) {
      const item = pickItem(rng, 'MYTHIC', LOOT_TABLES.LEGENDARY, supply);
      expect(item?.id).not.toBe('genesis_crown');
      expect(item?.rarity).toBe('LEGENDARY'); // downgraded one tier
    }
  });

  it('reserves limited supply as it drops', () => {
    const supply = LimitedSupplyTracker.fromDefinitions({ genesis_crown: 1 });
    expect(supply.canDrop('genesis_crown')).toBe(true);
    supply.reserve('genesis_crown');
    expect(supply.canDrop('genesis_crown')).toBe(false);
  });
});

describe('damage', () => {
  it('armor absorbs half the damage while it lasts', () => {
    expect(computeDamage(20, 25, 0.5)).toEqual({ healthDamage: 10, armorDamage: 10 });
    expect(computeDamage(20, 4, 0.5)).toEqual({ healthDamage: 16, armorDamage: 4 });
    expect(computeDamage(20, 0, 0.5)).toEqual({ healthDamage: 20, armorDamage: 0 });
  });

  it('applies distance falloff', () => {
    const f = { startRange: 100, endRange: 300, minMultiplier: 0.5 };
    expect(falloffMultiplier(50, f)).toBe(1);
    expect(falloffMultiplier(200, f)).toBeCloseTo(0.75);
    expect(falloffMultiplier(1000, f)).toBe(0.5);
    expect(bulletDamage(20, 1000, f)).toBe(10);
  });
});

describe('raid inventory', () => {
  it('stacks, respects capacity and reports leftovers', () => {
    const inv = new RaidInventory(2);
    expect(inv.addItem('scrap', 60)).toEqual({ added: 60, remaining: 0 }); // 50 + 10
    expect(inv.addItem('scrap', 45)).toEqual({ added: 40, remaining: 5 });
    expect(inv.addItem('gold_bar', 1)).toEqual({ added: 0, remaining: 1 });
    expect(inv.capacityFor('scrap')).toBe(0);
  });

  it('ammo goes to reserves and is capped', () => {
    const inv = RaidInventory.starter();
    const res = inv.addItem('ammo_light', 1000);
    expect(inv.ammo.light).toBe(PLAYER_CONFIG.maxAmmo.light);
    expect(res.remaining).toBe(1000 - (PLAYER_CONFIG.maxAmmo.light - PLAYER_CONFIG.startAmmo.light));
  });

  it('secure slot swaps with a bag slot and moves back', () => {
    const inv = new RaidInventory();
    inv.addItem('cyber_katana', 1);
    inv.addItem('scrap', 3);
    expect(inv.moveToSecure(0)).toBe(true);
    expect(inv.secure?.itemId).toBe('cyber_katana');
    expect(inv.slots[0]).toBeNull();
    expect(inv.moveToSecure(1)).toBe(true); // scrap in, katana swapped back to the bag
    expect(inv.secure?.itemId).toBe('scrap');
    expect(inv.slots[1]?.itemId).toBe('cyber_katana');
  });

  it('weapons fill free slots, then replace the active one', () => {
    const inv = RaidInventory.starter();
    expect(inv.equipWeapon(createWeapon('smg')).slot).toBe(1);
    expect(inv.equipWeapon(createWeapon('shotgun')).slot).toBe(2);
    const { replaced } = inv.equipWeapon(createWeapon('assault_rifle'));
    expect(replaced?.itemId).toBe('shotgun');
    expect(inv.activeWeapon()?.itemId).toBe('assault_rifle');
  });

  it('consumables are only consumed from the bag', () => {
    const inv = new RaidInventory();
    inv.addItem('medkit', 1);
    inv.moveToSecure(0);
    expect(inv.consumeFromBag('medkit')).toBe(false);
  });
});

describe('player death (run loss)', () => {
  const build = () => {
    const inv = RaidInventory.starter();
    inv.addItem('scrap', 50); // $2.50
    inv.addItem('copper_wire', 20); // $3.00
    inv.addItem('circuit_board', 10); // $12.00
    inv.addItem('gold_bar', 3); // $19.50
    inv.addItem('cyber_katana', 1); // $42.80
    inv.equipWeapon(createWeapon('assault_rifle')); // $6.00
    inv.moveToSecure(inv.slots.findIndex((s) => s?.itemId === 'cyber_katana'));
    return inv;
  };

  it('keeps the secure slot and secures at most 30 % of the rest, dropping >= 70 %', () => {
    const inv = build();
    const loss = computeRunLoss(inv, DEATH_LOSS_OPTIONS, new Rng(5));
    expect(loss.kept.find((k) => k.itemId === 'cyber_katana')?.qty).toBe(1);
    expect(loss.secureSlotValue).toBe(4280);
    const atRisk = 250 + 300 + 1200 + 1950 + 600;
    expect(loss.atRiskValue).toBe(atRisk);
    const target = Math.floor(atRisk * ECONOMY_CONFIG.death.autoSecureRatio);
    expect(loss.autoSecuredItemValue).toBeLessThanOrEqual(target);
    expect(loss.autoSecuredItemValue + loss.insuranceCents).toBe(target);
    const droppedValue = atRisk - loss.autoSecuredItemValue;
    expect(droppedValue / atRisk).toBeGreaterThanOrEqual(ECONOMY_CONFIG.death.dropRatio - 1e-9);
    expect(loss.securedValue + loss.lostValue).toBe(atRisk + loss.secureSlotValue);
    // Ammo drops, the starter pistol does not.
    expect(loss.droppedAmmo.find((a) => a.itemId === 'ammo_light')?.qty).toBe(PLAYER_CONFIG.startAmmo.light);
    expect(loss.droppedWeapons.some((w) => w.itemId === 'basic_pistol')).toBe(false);
  });

  it('conserves every item: kept + dropped = carried', () => {
    const inv = build();
    const loss = computeRunLoss(inv, DEATH_LOSS_OPTIONS, new Rng(11));
    const count = (id: string) =>
      (loss.kept.find((k) => k.itemId === id)?.qty ?? 0) +
      (loss.droppedItems.find((k) => k.itemId === id)?.qty ?? 0) +
      loss.droppedWeapons.filter((w) => w.itemId === id).length;
    expect(count('scrap')).toBe(50);
    expect(count('gold_bar')).toBe(3);
    expect(count('assault_rifle')).toBe(1);
    expect(count('cyber_katana')).toBe(1);
  });

  it('timeout keeps only the secure slot', () => {
    const loss = computeRunLoss(build(), TIMEOUT_LOSS_OPTIONS, new Rng(3));
    expect(loss.kept).toEqual([{ itemId: 'cyber_katana', qty: 1 }]);
    expect(loss.insuranceCents).toBe(0);
  });

  it('rarity config ranks are strictly increasing', () => {
    const ranks = RARITIES.map((r) => RARITY_CONFIG[r].rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});
