import { THREAT_CONFIG, type ThreatTierDef, type ThreatTierId } from '@extract/game-config';

type Tiers = readonly ThreatTierDef[];

/** Highest tier whose threshold the bag value reaches. */
export function threatTierFor(valueCents: number, tiers: Tiers = THREAT_CONFIG.tiers): ThreatTierDef {
  let tier = tiers[0]!;
  for (const t of tiers) if (valueCents >= t.minCents) tier = t;
  return tier;
}

export function threatTierById(id: ThreatTierId, tiers: Tiers = THREAT_CONFIG.tiers): ThreatTierDef {
  return tiers.find((t) => t.id === id) ?? tiers[0]!;
}

export function isTierAtLeast(valueCents: number, min: ThreatTierId, tiers: Tiers = THREAT_CONFIG.tiers): boolean {
  return threatTierFor(valueCents, tiers).rank >= threatTierById(min, tiers).rank;
}

export interface ThreatProgress {
  tier: ThreatTierDef;
  next: ThreatTierDef | null;
  /** 0..1 progress from the current tier threshold to the next (1 at the top tier). */
  progress: number;
}

export function threatProgress(valueCents: number, tiers: Tiers = THREAT_CONFIG.tiers): ThreatProgress {
  const tier = threatTierFor(valueCents, tiers);
  const next = tiers.find((t) => t.rank === tier.rank + 1) ?? null;
  if (!next) return { tier, next, progress: 1 };
  const span = Math.max(1, next.minCents - tier.minCents);
  return { tier, next, progress: Math.max(0, Math.min(1, (valueCents - tier.minCents) / span)) };
}
