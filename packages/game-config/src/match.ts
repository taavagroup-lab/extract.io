import type { MatchPhase } from '@extract/game-types';

const MIN = 60_000;

export const MATCH_CONFIG = {
  /** Architectural upper bound per match. */
  maxPlayers: 100,
  /** Default total players (humans + bots) per match. Overridable via MATCH_TARGET_PLAYERS. */
  defaultTargetPlayers: 20,
  /** Lobby waits this long for humans before bots top it up. */
  lobbyWaitMs: 8_000,
  /** While waiting, one bot "is found" every interval so the lobby fills visibly. */
  lobbyBotFillIntervalMs: 350,
  countdownMs: 5_000,
  /** Humans may still join a running match during this window. */
  lateJoinWindowMs: 90_000,
  durationMs: 10 * MIN,
  /** Phase schedule, relative to match start (LOOT_PHASE begin). */
  phases: [
    { phase: 'LOOT_PHASE', startMs: 0 },
    { phase: 'COMBAT_PHASE', startMs: 2 * MIN },
    { phase: 'EXTRACTION_PHASE', startMs: 7 * MIN },
  ] as const satisfies readonly { phase: MatchPhase; startMs: number }[],
  finalWarningAtMs: 9 * MIN,
  /** Room is disposed this long after FINISHED. */
  finishedLingerMs: 20_000,
  supplyDrops: {
    firstAtMs: 4 * MIN,
    intervalMs: [55_000, 80_000] as const,
    fallMs: 10_000,
    maxPerMatch: 5,
  },
  bountyRevealIntervalMs: 5_000,
} as const;

export const PHASE_LABELS: Record<MatchPhase, string> = {
  WAITING: 'Waiting',
  STARTING: 'Starting',
  LOOT_PHASE: 'Loot Phase',
  COMBAT_PHASE: 'Combat Phase',
  EXTRACTION_PHASE: 'Extraction Phase',
  FINISHED: 'Finished',
};
