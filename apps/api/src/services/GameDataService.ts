import type { BlockchainProvider } from '@extract/blockchain';
import { isUniqueViolation, periodKeyFor, type PrismaClient } from '@extract/database';
import { CURRENT_SEASON } from '@extract/game-config';
import type {
  LeaderboardCategory,
  LeaderboardDTO,
  LeaderboardPeriod,
  LeaderboardRowDTO,
  MatchHistoryDTO,
  ProfileDTO,
  Rarity,
  SeasonDTO,
  WalletDTO,
} from '@extract/game-types';
import { conflict, notFound } from '../errors';
import { toUserDTO } from '../mappers';

export const LEADERBOARD_MAX_PAGE_SIZE = 50;

/** Read models: leaderboards, profile, seasons + the optional wallet link. */
export class GameDataService {
  constructor(
    private readonly db: PrismaClient,
    private readonly chain: BlockchainProvider,
  ) {}

  async leaderboard(
    category: LeaderboardCategory,
    period: LeaderboardPeriod,
    opts: { page?: number; pageSize?: number; userId?: string | null } = {},
  ): Promise<LeaderboardDTO> {
    const periodKey = periodKeyFor(period, CURRENT_SEASON.id);
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const pageSize = Math.min(LEADERBOARD_MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.pageSize ?? 25)));
    const where = { category, period, periodKey, value: { gt: 0 } };
    const [total, rows] = await this.db.$transaction([
      this.db.leaderboardEntry.count({ where }),
      this.db.leaderboardEntry.findMany({
        where,
        // Ties: whoever reached the value first ranks higher.
        orderBy: [{ value: 'desc' }, { updatedAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { username: true } } },
      }),
    ]);
    const offset = (page - 1) * pageSize;
    return {
      category,
      period,
      periodKey,
      page,
      pageSize,
      total,
      rows: rows.map((r, i) => ({ rank: offset + i + 1, userId: r.userId, username: r.user.username, value: r.value })),
      me: opts.userId ? await this.rankOf(opts.userId, category, period, periodKey) : null,
    };
  }

  /** One indexed count query: players strictly ahead (same ordering as the board). */
  private async rankOf(userId: string, category: LeaderboardCategory, period: LeaderboardPeriod, periodKey: string): Promise<LeaderboardRowDTO | null> {
    const entry = await this.db.leaderboardEntry.findUnique({
      where: { userId_category_period_periodKey: { userId, category, period, periodKey } },
      include: { user: { select: { username: true } } },
    });
    if (!entry || entry.value <= 0) return null;
    const ahead = await this.db.leaderboardEntry.count({
      where: {
        category,
        period,
        periodKey,
        OR: [{ value: { gt: entry.value } }, { value: entry.value, updatedAt: { lt: entry.updatedAt } }],
      },
    });
    return { rank: ahead + 1, userId, username: entry.user.username, value: entry.value };
  }

  async profile(userId: string): Promise<ProfileDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user) throw notFound('User not found');
    const matches = await this.db.matchPlayer.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const p = user.profile;
    const totalMatches = p?.totalMatches ?? 0;
    const totalExtractions = p?.totalExtractions ?? 0;
    const seasonKey = periodKeyFor('SEASON', CURRENT_SEASON.id);
    const [standing, rankedPlayers] = await Promise.all([
      this.rankOf(userId, 'SEASON_XP', 'SEASON', seasonKey),
      this.db.leaderboardEntry.count({ where: { category: 'SEASON_XP', period: 'SEASON', periodKey: seasonKey, value: { gt: 0 } } }),
    ]);
    return {
      user: toUserDTO(user),
      stats: {
        totalMatches,
        totalKills: p?.totalKills ?? 0,
        totalDeaths: p?.totalDeaths ?? 0,
        totalExtractions,
        failedExtractions: Math.max(0, totalMatches - totalExtractions),
        totalLootExtractedCents: p?.totalLootExtractedCents ?? 0,
        highestSingleExtractionCents: p?.highestSingleExtractionCents ?? 0,
        highestKillStreak: p?.highestKillStreak ?? 0,
        bountyKills: p?.bountyKills ?? 0,
        bountyEarnedCents: p?.bountyEarnedCents ?? 0,
        legendaryExtracted: p?.legendaryExtracted ?? 0,
        kingpinExtractions: p?.kingpinExtractions ?? 0,
        totalXp: p?.totalXp ?? 0,
        playtimeMs: (p?.totalPlaytimeSec ?? 0) * 1000,
      },
      season: {
        seasonId: CURRENT_SEASON.id,
        seasonName: CURRENT_SEASON.name,
        xp: standing?.value ?? 0,
        rank: standing?.rank ?? null,
        rankedPlayers,
      },
      recentMatches: matches.map(
        (m): MatchHistoryDTO => ({
          matchId: m.matchId,
          outcome: m.outcome,
          kills: m.kills,
          lootValueCents: m.lootValueCents,
          securedValueCents: m.securedValueCents,
          survivedMs: m.survivedMs,
          xp: m.xp,
          createdAt: m.createdAt.toISOString(),
        }),
      ),
    };
  }

  async currentSeason(): Promise<SeasonDTO> {
    const season =
      (await this.db.season.findFirst({ where: { isActive: true }, include: { specialItems: true }, orderBy: { number: 'desc' } })) ??
      (await this.db.season.findUnique({ where: { id: CURRENT_SEASON.id }, include: { specialItems: true } }));
    if (!season) throw notFound('No active season (run pnpm db:seed)');
    return {
      id: season.id,
      number: season.number,
      name: season.name,
      startDate: season.startDate.toISOString(),
      endDate: season.endDate.toISOString(),
      isActive: season.isActive,
      specialItems: season.specialItems.map((i) => ({
        itemId: i.id,
        name: i.name,
        rarity: i.rarity as Rarity,
        maxSupply: i.maxSupply,
        currentSupply: i.currentSupply,
      })),
    };
  }

  async wallet(userId: string): Promise<WalletDTO | null> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user?.walletAddress) return null;
    return {
      address: user.walletAddress,
      chain: user.walletChain ?? this.chain.chain,
      provider: this.chain.name,
      balance: await this.chain.getBalance(user.walletAddress),
    };
  }

  /** Links an (optional) wallet. With the mock provider an address is generated. */
  async connectWallet(userId: string, address?: string): Promise<WalletDTO> {
    const wallet = await this.chain.connectWallet(address ? { address } : {});
    try {
      await this.db.user.update({ where: { id: userId }, data: { walletAddress: wallet.address, walletChain: wallet.chain } });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Wallet is linked to another account');
      throw err;
    }
    return { address: wallet.address, chain: wallet.chain, provider: wallet.provider, balance: await this.chain.getBalance(wallet.address) };
  }

  async disconnectWallet(userId: string): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { walletAddress: null, walletChain: null } });
  }
}
