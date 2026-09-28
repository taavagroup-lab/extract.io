import { PROGRESSION_CONFIG } from '@extract/game-config';

export type RunOutcomeKind = 'EXTRACTED' | 'DIED' | 'TIMEOUT' | 'ABANDONED';

export interface RunXpInput {
  outcome: RunOutcomeKind;
  kills: number;
  bountyKills: number;
  survivedMs: number;
  /** Bag value that actually made it out (0 unless extracted). */
  extractedValueCents: number;
}

export interface RunXp {
  total: number;
  survival: number;
  kills: number;
  bounty: number;
  extraction: number;
  value: number;
}

/**
 * Season XP for one run. Deterministic and integer; the game server is the
 * only caller that persists it. Quitting forfeits the survival part.
 */
export function computeRunXp(input: RunXpInput, cfg: typeof PROGRESSION_CONFIG = PROGRESSION_CONFIG): RunXp {
  const extracted = input.outcome === 'EXTRACTED';
  const seconds = Math.max(0, Math.floor(input.survivedMs / 1000));
  const survival = input.outcome === 'ABANDONED' ? 0 : Math.min(cfg.maxSurvivalXp, seconds * cfg.perSecondSurvived);
  const kills = Math.max(0, input.kills) * cfg.perKill;
  const bounty = Math.max(0, input.bountyKills) * cfg.perBountyKill;
  const extraction = extracted ? cfg.extractionBonus : 0;
  const value = extracted ? Math.min(cfg.maxValueXp, Math.floor(Math.max(0, input.extractedValueCents) / 100) * cfg.perExtractedUnit) : 0;
  return { total: survival + kills + bounty + extraction + value, survival, kills, bounty, extraction, value };
}
