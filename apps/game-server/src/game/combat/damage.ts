import { PLAYER_CONFIG } from '@extract/game-config';
import type { DamageFalloff } from '@extract/game-types';

/** Distance based damage multiplier (linear between start and end range). */
export function falloffMultiplier(distance: number, f: DamageFalloff): number {
  if (distance <= f.startRange) return 1;
  if (distance >= f.endRange) return f.minMultiplier;
  const t = (distance - f.startRange) / (f.endRange - f.startRange);
  return 1 - t * (1 - f.minMultiplier);
}

export function bulletDamage(baseDamage: number, distance: number, f: DamageFalloff): number {
  return Math.max(1, Math.round(baseDamage * falloffMultiplier(distance, f)));
}

export interface DamageResult {
  healthDamage: number;
  armorDamage: number;
}

/**
 * Armor absorbs `absorbRatio` of incoming damage until it is depleted.
 * `armorMultiplier` is how many armor points each absorbed point costs
 * (armor-piercing weapons strip armor faster).
 * Example: 20 dmg vs 25 armor @ 0.5 -> 10 armor, 10 health.
 */
export function computeDamage(
  amount: number,
  armor: number,
  absorbRatio: number = PLAYER_CONFIG.armorAbsorbRatio,
  armorMultiplier = 1,
): DamageResult {
  const dmg = Math.max(0, amount);
  const mul = Math.max(0.01, armorMultiplier);
  const absorbed = Math.min(Math.max(0, armor) / mul, dmg * absorbRatio);
  return { healthDamage: dmg - absorbed, armorDamage: Math.min(Math.max(0, armor), absorbed * mul) };
}
