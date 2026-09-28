import type { Cents, EntityId, Vec2 } from './common';

export const MATCH_PHASES = [
  'WAITING',
  'STARTING',
  'LOOT_PHASE',
  'COMBAT_PHASE',
  'EXTRACTION_PHASE',
  'FINISHED',
] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

/** Phases in which the world simulation runs. */
export const ACTIVE_PHASES: readonly MatchPhase[] = ['LOOT_PHASE', 'COMBAT_PHASE', 'EXTRACTION_PHASE'];

export interface ExtractionState {
  id: string;
  name: string;
  position: Vec2;
  radius: number;
  active: boolean;
  /** Match time (ms) at which the zone became active, null while inactive. */
  activationTime: number | null;
  /** Entity ids of players currently extracting here. */
  playersCurrentlyExtracting: EntityId[];
}

export interface SupplyDropState {
  id: number;
  x: number;
  y: number;
  /** Match time (ms) at which the drop lands and becomes lootable. */
  landsAtMs: number;
  landed: boolean;
  opened: boolean;
}

export interface BountyMarker {
  playerId: EntityId;
  name: string;
  /** Approximate (fuzzed) position, refreshed every few seconds. */
  x: number;
  y: number;
  radius: number;
  bountyCents: Cents;
  kills: number;
}

/** Approximate position of a KINGPIN-tier bag, refreshed periodically. */
export interface KingpinMarker {
  playerId: EntityId;
  name: string;
  x: number;
  y: number;
  radius: number;
  bagCents: Cents;
}

/** Match-wide state every client receives (only when it changes). */
export interface MatchGlobalState {
  matchId: string;
  phase: MatchPhase;
  /** Match time (ms since LOOT_PHASE start). */
  timeMs: number;
  durationMs: number;
  alive: number;
  total: number;
  highValueActive: boolean;
  extractionZones: ExtractionState[];
  supplyDrops: SupplyDropState[];
  bounties: BountyMarker[];
  kingpins: KingpinMarker[];
}

/** Spec alias. */
export type MatchState = MatchGlobalState;

export interface LobbyState {
  phase: 'WAITING' | 'STARTING';
  found: number;
  target: number;
  humans: number;
  /** Remaining countdown (ms) in STARTING. */
  countdownMs: number | null;
}
