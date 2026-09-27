import { ECONOMY_CONFIG } from '@extract/game-config';
import type { LeaderboardCategory, LeaderboardPeriod } from '@extract/game-types';
import { Prisma, type PrismaClient } from '@prisma/client';
import { isUniqueViolation, type Tx } from './client';
import { periodKeyFor } from './periods';

export type MatchOutcomeKind = 'EXTRACTED' | 'DIED' | 'TIMEOUT' | 'ABANDONED';

export interface PersistItem {
  itemId: string;
  qty: number;
}

export interface PlayerResultInput {
  matchId: string;
  userId: string;
  seasonId: string | null;
  outcome: MatchOutcomeKind;
  kills: number;
  damageDealt: number;
  survivedMs: number;
  /** Total value carried at the end of the run. */
  lootValueCents: number;
  securedValueCents: number;
  lostValueCents: number;
  /** Bounty rewards paid out (only on extraction). */
  bountyEarnedCents: number;
  bountyKills: number;
  /** TEST USDC credited on top of items (death insurance). */
  payoutCents: number;
  /** Items transferred into the persistent account inventory. */
  items: PersistItem[];
  extraction: { pointId: string; valueCents: number } | null;
}

export interface GrantedItem {
  itemId: string;
  qty: number;
  serialNumber: number | null;
}

export interface PlayerResultOutcome {
  status: 'saved' | 'duplicate';
  granted: GrantedItem[];
  /** Paid out instead of limited items whose supply ran out. */
  compensationCents: number;
}

export interface KillInput {
  matchId: string;
  killerUserId: string | null;
  victimUserId: string | null;
  killerName: string | null;
  victimName: string;
  weaponId: string | null;
  wasBountyKill: boolean;
  bountyCents: number;
}

export interface MatchStartInput {
  matchId: string;
  seasonId: string | null;
  mapId: string;
  startedAt: Date;
}

export interface MatchFinishInput {
  matchId: string;
  endedAt: Date;
  playerCount: number;
  botCount: number;
  summary: Prisma.InputJsonValue;
}

const PERIODS: LeaderboardPeriod[] = ['WEEKLY', 'SEASON', 'ALL_TIME'];

/**
 * Persists match lifecycle and player results. Every write that grants value
 * runs in one transaction and is idempotent via MatchPlayer(matchId, userId).
 */
export class MatchResultRepository {
  constructor(private readonly db: PrismaClient) {}

  async createMatch(input: MatchStartInput): Promise<void> {
    await this.db.match.upsert({
      where: { id: input.matchId },
      create: { id: input.matchId, seasonId: input.seasonId, mapId: input.mapId, startedAt: input.startedAt },
      update: {},
    });
  }

  async finishMatch(input: MatchFinishInput): Promise<void> {
    await this.db.match.updateMany({
      where: { id: input.matchId },
      data: {
        status: 'FINISHED',
        endedAt: input.endedAt,
        playerCount: input.playerCount,
        botCount: input.botCount,
        summary: input.summary,
      },
    });
  }

  async recordKill(input: KillInput): Promise<void> {
    await this.db.kill.create({ data: input });
  }

  /** Remaining supply for limited items: itemId -> remaining. */
  async getLimitedSupply(): Promise<Record<string, number>> {
    const rows = await this.db.itemDefinition.findMany({
      where: { maxSupply: { not: null } },
      select: { id: true, maxSupply: true, currentSupply: true },
    });
    return Object.fromEntries(rows.map((r) => [r.id, Math.max(0, (r.maxSupply ?? 0) - r.currentSupply)]));
  }

  async savePlayerResult(input: PlayerResultInput): Promise<PlayerResultOutcome> {
    try {
      return await this.db.$transaction(async (tx) => this.saveInTx(tx, input), { timeout: 15_000 });
    } catch (err) {
      if (isUniqueViolation(err)) return { status: 'duplicate', granted: [], compensationCents: 0 };
      throw err;
    }
  }

  private async saveInTx(tx: Tx, input: PlayerResultInput): Promise<PlayerResultOutcome> {
    // 1. Idempotency guard: fails with P2002 if this result was already stored.
    await tx.matchPlayer.create({
      data: {
        matchId: input.matchId,
        userId: input.userId,
        outcome: input.outcome,
        kills: input.kills,
        damageDealt: Math.round(input.damageDealt),
        lootValueCents: input.lootValueCents,
        securedValueCents: input.securedValueCents,
        lostValueCents: input.lostValueCents,
        bountyEarnedCents: input.bountyEarnedCents,
        survivedMs: Math.round(input.survivedMs),
      },
    });

    await tx.playerProfile.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, balanceCents: ECONOMY_CONFIG.startingBalanceCents },
      update: {},
    });
    const inventory = await tx.inventory.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId },
      update: {},
    });

    // 2. Items.
    const { granted, compensationCents } = await this.grantItems(tx, inventory.id, input);

    // 3. Extraction record.
    const extracted = input.outcome === 'EXTRACTED';
    const extractedValue = extracted && input.extraction ? input.extraction.valueCents : 0;
    if (extracted && input.extraction) {
      await tx.extraction.create({
        data: {
          matchId: input.matchId,
          userId: input.userId,
          extractionPointId: input.extraction.pointId,
          itemCount: granted.reduce((n, g) => n + g.qty, 0),
          valueCents: input.extraction.valueCents,
          survivedMs: Math.round(input.survivedMs),
        },
      });
    }

    // 4. Profile stats + balance (atomic SQL, GREATEST for records).
    const credit = input.bountyEarnedCents + input.payoutCents + compensationCents;
    await tx.$executeRaw`
      UPDATE "PlayerProfile" SET
        "totalMatches" = "totalMatches" + 1,
        "totalKills" = "totalKills" + ${input.kills},
        "totalDeaths" = "totalDeaths" + ${input.outcome === 'DIED' ? 1 : 0},
        "totalExtractions" = "totalExtractions" + ${extracted ? 1 : 0},
        "totalLootExtractedCents" = "totalLootExtractedCents" + ${extractedValue},
        "highestSingleExtractionCents" = GREATEST("highestSingleExtractionCents", ${extractedValue}),
        "highestKillStreak" = GREATEST("highestKillStreak", ${input.kills}),
        "bountyKills" = "bountyKills" + ${input.bountyKills},
        "bountyEarnedCents" = "bountyEarnedCents" + ${input.bountyEarnedCents},
        "balanceCents" = "balanceCents" + ${credit},
        "updatedAt" = NOW()
      WHERE "userId" = ${input.userId}`;

    // 5. Leaderboards.
    const stats: [LeaderboardCategory, number, 'sum' | 'max'][] = [
      ['MOST_KILLS', input.kills, 'sum'],
      ['MOST_EXTRACTIONS', extracted ? 1 : 0, 'sum'],
      ['HIGHEST_LOOT_EXTRACTED', extractedValue, 'sum'],
      ['HIGHEST_SINGLE_EXTRACTION', extractedValue, 'max'],
      ['HIGHEST_KILL_STREAK', input.kills, 'max'],
      ['BOUNTY_KILLS', input.bountyKills, 'sum'],
    ];
    const now = new Date();
    for (const [category, value, mode] of stats) {
      if (value <= 0) continue;
      for (const period of PERIODS) {
        await upsertLeaderboard(tx, {
          userId: input.userId,
          category,
          period,
          periodKey: periodKeyFor(period, input.seasonId, now),
          seasonId: period === 'SEASON' ? input.seasonId : null,
          value,
          mode,
        });
      }
    }

    return { status: 'saved', granted, compensationCents };
  }

  private async grantItems(
    tx: Tx,
    inventoryId: string,
    input: PlayerResultInput,
  ): Promise<{ granted: GrantedItem[]; compensationCents: number }> {
    const granted: GrantedItem[] = [];
    let compensationCents = 0;
    if (input.items.length === 0) return { granted, compensationCents };

    const defs = await tx.itemDefinition.findMany({ where: { id: { in: input.items.map((i) => i.itemId) } } });
    const byId = new Map(defs.map((d) => [d.id, d]));

    for (const item of input.items) {
      const def = byId.get(item.itemId);
      if (!def || !def.persistable || item.qty <= 0) continue;
      const base = {
        inventoryId,
        itemDefinitionId: def.id,
        seasonId: input.seasonId,
        sourceMatchId: input.matchId,
      };

      if (def.maxSupply !== null) {
        // Limited: claim a serial number atomically per unit.
        for (let n = 0; n < item.qty; n++) {
          const rows = await tx.$queryRaw<{ currentSupply: number }[]>`
            UPDATE "ItemDefinition" SET "currentSupply" = "currentSupply" + 1
            WHERE "id" = ${def.id} AND "currentSupply" < "maxSupply"
            RETURNING "currentSupply"`;
          const serial = rows[0]?.currentSupply;
          if (serial === undefined) {
            compensationCents += def.estimatedValueCents;
            continue;
          }
          await tx.inventoryItem.create({ data: { ...base, quantity: 1, serialNumber: serial } });
          granted.push({ itemId: def.id, qty: 1, serialNumber: serial });
        }
      } else if (def.stackable) {
        const existing = await tx.inventoryItem.findFirst({
          where: { inventoryId, itemDefinitionId: def.id, status: 'OWNED', serialNumber: null, mintAddress: null },
        });
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { quantity: { increment: item.qty }, acquiredAt: new Date(), sourceMatchId: input.matchId },
          });
        } else {
          await tx.inventoryItem.create({ data: { ...base, quantity: item.qty } });
        }
        granted.push({ itemId: def.id, qty: item.qty, serialNumber: null });
      } else {
        for (let n = 0; n < item.qty; n++) {
          await tx.inventoryItem.create({ data: { ...base, quantity: 1 } });
        }
        granted.push({ itemId: def.id, qty: item.qty, serialNumber: null });
      }
    }
    return { granted, compensationCents };
  }
}

async function upsertLeaderboard(
  tx: Tx,
  e: {
    userId: string;
    category: LeaderboardCategory;
    period: LeaderboardPeriod;
    periodKey: string;
    seasonId: string | null;
    value: number;
    mode: 'sum' | 'max';
  },
): Promise<void> {
  const merge =
    e.mode === 'sum'
      ? Prisma.sql`"LeaderboardEntry"."value" + EXCLUDED."value"`
      : Prisma.sql`GREATEST("LeaderboardEntry"."value", EXCLUDED."value")`;
  await tx.$executeRaw`
    INSERT INTO "LeaderboardEntry" ("userId", "category", "period", "periodKey", "seasonId", "value", "updatedAt")
    VALUES (${e.userId}, ${e.category}::"LeaderboardCategory", ${e.period}::"LeaderboardPeriod", ${e.periodKey}, ${e.seasonId}, ${e.value}, NOW())
    ON CONFLICT ("userId", "category", "period", "periodKey")
    DO UPDATE SET "value" = ${merge}, "updatedAt" = NOW()`;
}
