import type { ItemAmount } from '@extract/game-types';

/**
 * Persistence boundary of the game server. Game logic depends only on this
 * interface; the Prisma adapter lives in PrismaPersistence.ts.
 */

export type RunOutcome = 'EXTRACTED' | 'DIED' | 'TIMEOUT' | 'ABANDONED';

export interface PlayerRunResult {
  matchId: string;
  userId: string;
  seasonId: string | null;
  outcome: RunOutcome;
  kills: number;
  damageDealt: number;
  survivedMs: number;
  lootValueCents: number;
  securedValueCents: number;
  lostValueCents: number;
  bountyEarnedCents: number;
  bountyKills: number;
  payoutCents: number;
  items: ItemAmount[];
  extraction: { pointId: string; valueCents: number } | null;
  /** Season XP for this run (shared computeRunXp). */
  xp: number;
}

export interface KillRecord {
  matchId: string;
  killerUserId: string | null;
  victimUserId: string | null;
  killerName: string | null;
  victimName: string;
  weaponId: string | null;
  wasBountyKill: boolean;
  bountyCents: number;
}

export interface MatchStartRecord {
  matchId: string;
  seasonId: string | null;
  mapId: string;
  startedAt: Date;
}

export interface MatchFinishRecord {
  matchId: string;
  endedAt: Date;
  playerCount: number;
  botCount: number;
  summary: Record<string, unknown>;
}

export interface GamePersistence {
  getLimitedSupply(): Promise<Record<string, number>>;
  matchStarted(record: MatchStartRecord): Promise<void>;
  matchFinished(record: MatchFinishRecord): Promise<void>;
  killRecorded(record: KillRecord): Promise<void>;
  savePlayerResult(result: PlayerRunResult): Promise<void>;
}
