import { PROGRESSION_CONFIG, THREAT_CONFIG, getItemDef } from '@extract/game-config';
import type { WeaponInstance } from '@extract/game-types';
import { describe, expect, it } from 'vitest';
import {
  buildShareText,
  carriedValue,
  computeRunXp,
  formatAmount,
  formatMoney,
  isTierAtLeast,
  shareHighlights,
  summarizeItems,
  threatProgress,
  threatTierFor,
  xIntentUrl,
  type ShareResult,
} from '../src';

const TEST = { code: 'USDC', mode: 'TEST' as const };
const LIVE = { code: 'USDC', mode: 'LIVE' as const };

describe('bag value', () => {
  it('sums configured estimated values of bag, secure slot and non-starter weapons', () => {
    const slots = [
      { uid: 'a', itemId: 'gold_bar', qty: 2 },
      null,
      { uid: 'b', itemId: 'scrap', qty: 10 },
    ];
    const secure = { uid: 'c', itemId: 'quantum_core', qty: 1 };
    const weapons: WeaponInstance[] = [
      { uid: 'w1', itemId: 'basic_pistol', weaponId: 'basic_pistol', mag: 12 },
      { uid: 'w2', itemId: 'assault_rifle', weaponId: 'assault_rifle', mag: 30 },
    ];
    const expected =
      getItemDef('gold_bar').estimatedValue * 2 +
      getItemDef('scrap').estimatedValue * 10 +
      getItemDef('quantum_core').estimatedValue +
      getItemDef('assault_rifle').estimatedValue;
    expect(carriedValue(slots, secure, weapons)).toBe(expected);
  });

  it('summarizes value and rarity counts deterministically and ignores starter gear', () => {
    const s = summarizeItems([
      { itemId: 'genesis_crown', qty: 1 },
      { itemId: 'cyber_katana', qty: 1 },
      { itemId: 'circuit_board', qty: 3 },
      { itemId: 'basic_pistol', qty: 1 },
    ]);
    expect(s.valueCents).toBe(25_000 + 4_280 + 120 * 3);
    expect(s.rarityCounts).toEqual({ MYTHIC: 1, LEGENDARY: 1, RARE: 3 });
    expect(s.units).toBe(5);
  });
});

describe('threat tiers', () => {
  const [normal, high, wanted, kingpin] = THREAT_CONFIG.tiers;

  it('maps values to the configured tiers with inclusive lower bounds', () => {
    expect(threatTierFor(0).id).toBe('NORMAL');
    expect(threatTierFor(high.minCents - 1).id).toBe('NORMAL');
    expect(threatTierFor(high.minCents).id).toBe('HIGH_VALUE');
    expect(threatTierFor(wanted.minCents).id).toBe('WANTED');
    expect(threatTierFor(kingpin.minCents).id).toBe('KINGPIN');
    expect(threatTierFor(10_000_000).id).toBe('KINGPIN');
    expect(normal.minCents).toBe(0);
  });

  it('reports progress towards the next tier', () => {
    const mid = Math.round((high.minCents + wanted.minCents) / 2);
    const p = threatProgress(mid);
    expect(p.tier.id).toBe('HIGH_VALUE');
    expect(p.next?.id).toBe('WANTED');
    expect(p.progress).toBeCloseTo(0.5, 2);
    expect(threatProgress(kingpin.minCents + 1).progress).toBe(1);
    expect(threatProgress(kingpin.minCents).next).toBeNull();
  });

  it('compares tiers by rank', () => {
    expect(isTierAtLeast(kingpin.minCents, 'KINGPIN')).toBe(true);
    expect(isTierAtLeast(wanted.minCents, 'KINGPIN')).toBe(false);
    expect(isTierAtLeast(wanted.minCents, 'HIGH_VALUE')).toBe(true);
  });

  it('accepts custom tier tables (balance stays configurable)', () => {
    const tiers = [
      { id: 'NORMAL', label: 'N', minCents: 0, color: '#000', rank: 0 },
      { id: 'KINGPIN', label: 'K', minCents: 100, color: '#fff', rank: 1 },
    ] as const;
    expect(threatTierFor(99, tiers).id).toBe('NORMAL');
    expect(threatTierFor(100, tiers).id).toBe('KINGPIN');
  });
});

describe('season XP', () => {
  const cfg = PROGRESSION_CONFIG;

  it('rewards survival, kills, bounties and extracted value', () => {
    const xp = computeRunXp({ outcome: 'EXTRACTED', kills: 3, bountyKills: 1, survivedMs: 125_900, extractedValueCents: 4_250 });
    expect(xp.survival).toBe(125 * cfg.perSecondSurvived);
    expect(xp.kills).toBe(3 * cfg.perKill);
    expect(xp.bounty).toBe(cfg.perBountyKill);
    expect(xp.extraction).toBe(cfg.extractionBonus);
    expect(xp.value).toBe(42 * cfg.perExtractedUnit);
    expect(xp.total).toBe(xp.survival + xp.kills + xp.bounty + xp.extraction + xp.value);
  });

  it('gives no extraction XP on death and no survival XP when quitting', () => {
    const died = computeRunXp({ outcome: 'DIED', kills: 2, bountyKills: 0, survivedMs: 60_000, extractedValueCents: 9_999 });
    expect(died.extraction + died.value).toBe(0);
    expect(died.total).toBe(60 + 2 * cfg.perKill);
    const quit = computeRunXp({ outcome: 'ABANDONED', kills: 0, bountyKills: 0, survivedMs: 300_000, extractedValueCents: 0 });
    expect(quit.total).toBe(0);
  });

  it('caps survival and value XP', () => {
    const xp = computeRunXp({ outcome: 'EXTRACTED', kills: 0, bountyKills: 0, survivedMs: 3_600_000, extractedValueCents: 100_000_000 });
    expect(xp.survival).toBe(cfg.maxSurvivalXp);
    expect(xp.value).toBe(cfg.maxValueXp);
  });
});

describe('money + share formatting', () => {
  it('spells out TEST USDC in test mode and uses $ in live mode', () => {
    expect(formatAmount(8_472)).toBe('84.72');
    expect(formatAmount(1_234_567)).toBe('12,345.67');
    expect(formatMoney(8_472, TEST)).toBe('84.72 TEST USDC');
    expect(formatMoney(8_472, LIVE)).toBe('$84.72');
    expect(formatMoney(-150, LIVE)).toBe('-$1.50');
  });

  const result: ShareResult = {
    playerName: 'Raider',
    kills: 6,
    bagValueCents: 8_472,
    rarityCounts: { LEGENDARY: 1, RARE: 4 },
    seasonNumber: 1,
    seasonName: 'THE GENESIS',
  };

  it('builds card highlights', () => {
    expect(shareHighlights(result, TEST)).toEqual(['6 KILLS', '84.72 TEST USDC BAG', '1 LEGENDARY']);
    expect(shareHighlights({ ...result, kills: 1, rarityCounts: { EPIC: 2 } }, LIVE)).toEqual(['1 KILL', '$84.72 BAG', '2 EPIC']);
    expect(shareHighlights({ ...result, rarityCounts: {} }, LIVE)).toEqual(['6 KILLS', '$84.72 BAG']);
  });

  it('never presents test values as real money in the post text', () => {
    const test = buildShareText(result, TEST);
    expect(test).toContain('84.72 TEST USDC bag');
    expect(test).not.toContain('$');
    expect(test).toContain('6 kills.');
    expect(test).toContain('1 legendary.');
    expect(test.trim().endsWith('extract.io')).toBe(true);
    expect(buildShareText(result, LIVE)).toContain('Just extracted a $84.72 bag in EXTRACT.SOL.');
  });

  it('encodes the X intent url', () => {
    const url = xIntentUrl('a b\n$1');
    expect(url.startsWith('https://x.com/intent/tweet?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1]!)).toBe('a b\n$1');
  });
});
