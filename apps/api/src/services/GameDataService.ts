import type { BlockchainProvider } from '@extract/blockchain';
import { isUniqueViolation, periodKeyFor, type PrismaClient } from '@extract/database';
import { CURRENT_SEASON } from '@extract/game-config';
import type {
  LeaderboardCategory,
  LeaderboardDTO,
  LeaderboardPeriod,
  MatchHistoryDTO,
  ProfileDTO,
  Rarity,
  SeasonDTO,
  WalletDTO,
} from '@extract/game-types';
import { conflict, notFound } from '../errors';
import { toUserDTO } from '../mappers';

/** Read models: leaderboards, profile, seasons + the optional wallet link. */
export class GameDataService {
  constructor(
    private readonly db: PrismaClient,
    private readonly chain: BlockchainProvider,
  ) {}

  async leaderboard(category: LeaderboardCategory, period: LeaderboardPeriod, limit = 100): Promise<LeaderboardDTO> {
    const periodKey = periodKeyFor(period, CURRENT_SEASON.id);
    const rows = await this.db.leaderboardEntry.findMany({
      where: { category, period, periodKey, value: { gt: 0 } },
      orderBy: [{ value: 'desc' }, { updatedAt: 'asc' }],
      take: Math.min(100, Math.max(1, limit)),
      include: { user: { select: { username: true } } },
    });
    return {
      category,
      period,
      periodKey,
      rows: rows.map((r, i) => ({ rank: i + 1, userId: r.userId, username: r.user.username, value: r.value })),
    };
  }

  async profile(userId: string): Promise<ProfileDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user) throw notFound('User not found');
    const matches = await this.db.matchPlayer.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const p = user.profile;
    return {
      user: toUserDTO(user),
      stats: {
        totalMatches: p?.totalMatches ?? 0,
        totalKills: p?.totalKills ?? 0,
        totalDeaths: p?.totalDeaths ?? 0,
        totalExtractions: p?.totalExtractions ?? 0,
        totalLootExtractedCents: p?.totalLootExtractedCents ?? 0,
        highestSingleExtractionCents: p?.highestSingleExtractionCents ?? 0,
        highestKillStreak: p?.highestKillStreak ?? 0,
        bountyKills: p?.bountyKills ?? 0,
        bountyEarnedCents: p?.bountyEarnedCents ?? 0,
      },
      recentMatches: matches.map(
        (m): MatchHistoryDTO => ({
          matchId: m.matchId,
          outcome: m.outcome,
          kills: m.kills,
          lootValueCents: m.lootValueCents,
          securedValueCents: m.securedValueCents,
          survivedMs: m.survivedMs,
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
