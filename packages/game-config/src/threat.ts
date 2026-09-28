/**
 * Bag value threat tiers. Presentation first: the tier drives HUD colour and
 * copy. Only KINGPIN has a gameplay effect (periodic approximate location
 * reveal), and that is switchable via `kingpinReveal.enabled`.
 * Thresholds are integer cents of the reference currency.
 */
export const THREAT_TIER_IDS = ['NORMAL', 'HIGH_VALUE', 'WANTED', 'KINGPIN'] as const;
export type ThreatTierId = (typeof THREAT_TIER_IDS)[number];

export interface ThreatTierDef {
  id: ThreatTierId;
  label: string;
  /** Inclusive lower bound (cents). */
  minCents: number;
  color: string;
  rank: number;
}

export interface KingpinRevealConfig {
  enabled: boolean;
  minTier: ThreatTierId;
  intervalMs: number;
  fuzzRadius: number;
  announce: boolean;
  reannounceCooldownMs: number;
}

export const THREAT_CONFIG = {
  /** Sorted ascending by minCents. */
  tiers: [
    { id: 'NORMAL', label: 'NORMAL', minCents: 0, color: '#8b95a7', rank: 0 },
    { id: 'HIGH_VALUE', label: 'HIGH VALUE', minCents: 1_000, color: '#f5c542', rank: 1 },
    { id: 'WANTED', label: 'WANTED', minCents: 2_500, color: '#ff8a3d', rank: 2 },
    { id: 'KINGPIN', label: 'KINGPIN', minCents: 5_000, color: '#ff4d5e', rank: 3 },
  ] as const satisfies readonly ThreatTierDef[],
  kingpinReveal: {
    /** Set to false to stop broadcasting positions (KINGPIN stays a HUD/nameplate state). */
    enabled: true,
    /** Tier at which a bag counts as KINGPIN (flag, announcement, reveal). */
    minTier: 'KINGPIN' as ThreatTierId,
    /** How often the fuzzed position refreshes. */
    intervalMs: 15_000,
    /** Marker radius; the true position is somewhere inside. */
    fuzzRadius: 320,
    /** Broadcast "KINGPIN DETECTED" when someone reaches the tier. */
    announce: true,
    /** Dropping below the tier and rising again re-announces only after this. */
    reannounceCooldownMs: 60_000,
  },
} as const;
