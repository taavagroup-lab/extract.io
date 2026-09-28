-- Presentation / meta-game stats: season XP, KINGPIN extractions, legendary
-- extraction count and raid playtime. Additive only; no existing data is
-- removed. Requires PostgreSQL 12+ (several enum values in one migration).

-- AlterEnum
ALTER TYPE "LeaderboardCategory" ADD VALUE 'SEASON_XP';
ALTER TYPE "LeaderboardCategory" ADD VALUE 'KINGPIN_EXTRACTIONS';

-- AlterTable
ALTER TABLE "MatchPlayer" ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PlayerProfile" ADD COLUMN     "kingpinExtractions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "legendaryExtracted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalPlaytimeSec" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalXp" INTEGER NOT NULL DEFAULT 0;

-- Backfill: playtime can be reconstructed exactly from stored match results.
-- XP, legendary and KINGPIN counters did not exist before and start at 0
-- (reconstructing them would mean inventing numbers).
UPDATE "PlayerProfile" AS p
SET "totalPlaytimeSec" = sub.sec
FROM (
  SELECT "userId", (SUM("survivedMs") / 1000)::INTEGER AS sec
  FROM "MatchPlayer"
  GROUP BY "userId"
) AS sub
WHERE sub."userId" = p."userId";

-- Integrity guards
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_meta_stats_non_negative"
  CHECK ("legendaryExtracted" >= 0 AND "kingpinExtractions" >= 0 AND "totalXp" >= 0 AND "totalPlaytimeSec" >= 0);
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_xp_non_negative" CHECK ("xp" >= 0);
