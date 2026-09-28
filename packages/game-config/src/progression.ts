/**
 * Season XP. Computed by the game server when a run ends (never by the
 * client), persisted per match and summed into the SEASON_XP leaderboard.
 */
export const PROGRESSION_CONFIG = {
  /** XP per full second survived in the raid. */
  perSecondSurvived: 1,
  /** Cap for survival XP (a full 10 minute raid). */
  maxSurvivalXp: 600,
  perKill: 50,
  perBountyKill: 100,
  /** Flat bonus for making it out. */
  extractionBonus: 250,
  /** Extraction XP per whole unit (100 cents) of extracted bag value. */
  perExtractedUnit: 10,
  /** Cap for the value part so a single jackpot does not dominate the season. */
  maxValueXp: 3_000,
} as const;
