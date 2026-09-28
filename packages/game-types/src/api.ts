import type { Cents } from './common';
import type { ItemId, ItemType, Rarity } from './items';

// DTOs shared between the REST API and the web client.

export interface UserDTO {
  id: string;
  username: string;
  isGuest: boolean;
  balanceCents: Cents;
  walletAddress: string | null;
  walletChain: string | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserDTO;
}

export interface BlockchainInfoDTO {
  chain: string;
  mintAddress: string | null;
  tokenId: string | null;
  blockchainAssetId: string | null;
  ownerWallet: string | null;
}

export type InventoryItemStatus = 'OWNED' | 'LISTED';

export interface InventoryItemDTO {
  id: string;
  itemId: ItemId;
  name: string;
  type: ItemType;
  rarity: Rarity;
  icon: string;
  quantity: number;
  estimatedValue: Cents;
  acquiredAt: string;
  seasonId: string | null;
  seasonName: string | null;
  serialNumber: number | null;
  maxSupply: number | null;
  /** Limited items: how many serials have been extracted so far (null for unlimited items). */
  discovered: number | null;
  status: InventoryItemStatus;
  blockchain: BlockchainInfoDTO | null;
}

export type ListingStatus = 'ACTIVE' | 'SOLD' | 'CANCELLED';

export interface ListingDTO {
  id: string;
  itemId: ItemId;
  name: string;
  rarity: Rarity;
  icon: string;
  quantity: number;
  priceCents: Cents;
  estimatedValue: Cents;
  sellerId: string;
  sellerName: string;
  status: ListingStatus;
  serialNumber: number | null;
  maxSupply: number | null;
  createdAt: string;
  seasonName: string | null;
  /** Limited items: serials still undiscovered (null when unlimited). */
  remainingSupply: number | null;
  /** Lowest active asking price per unit for this item (null when unknown). */
  floorCents: Cents | null;
  /** Price per unit of the most recent completed sale of this item. */
  lastSaleCents: Cents | null;
}

export type ListingSort = 'price_asc' | 'price_desc' | 'newest' | 'rarity';

export interface ListingQuery {
  search?: string;
  rarity?: Rarity;
  sort?: ListingSort;
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TransactionDTO {
  id: string;
  listingId: string;
  itemName: string;
  rarity: Rarity;
  quantity: number;
  priceCents: Cents;
  feeCents: Cents;
  sellerProceedsCents: Cents;
  role: 'buyer' | 'seller';
  counterparty: string;
  createdAt: string;
}

export const LEADERBOARD_CATEGORIES = [
  'MOST_KILLS',
  'MOST_EXTRACTIONS',
  'HIGHEST_LOOT_EXTRACTED',
  'HIGHEST_SINGLE_EXTRACTION',
  'HIGHEST_KILL_STREAK',
  'BOUNTY_KILLS',
  'SEASON_XP',
  'KINGPIN_EXTRACTIONS',
] as const;
export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];

export const LEADERBOARD_PERIODS = ['WEEKLY', 'SEASON', 'ALL_TIME'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export interface LeaderboardRowDTO {
  rank: number;
  userId: string;
  username: string;
  value: number;
}

export interface LeaderboardDTO {
  category: LeaderboardCategory;
  period: LeaderboardPeriod;
  periodKey: string;
  rows: LeaderboardRowDTO[];
  page: number;
  pageSize: number;
  /** Ranked players in this board (value > 0). */
  total: number;
  /** The requesting player's row, when signed in and ranked. */
  me: LeaderboardRowDTO | null;
}

export interface PlayerStatsDTO {
  totalMatches: number;
  totalKills: number;
  totalDeaths: number;
  totalExtractions: number;
  /** Runs that ended without extracting (death, timeout, quit). */
  failedExtractions: number;
  totalLootExtractedCents: Cents;
  highestSingleExtractionCents: Cents;
  highestKillStreak: number;
  bountyKills: number;
  bountyEarnedCents: Cents;
  /** LEGENDARY + MYTHIC units that made it out (tracked since the stat was introduced). */
  legendaryExtracted: number;
  /** Extractions with a KINGPIN-tier bag. */
  kingpinExtractions: number;
  totalXp: number;
  /** Time spent inside raids, in ms. */
  playtimeMs: number;
}

export interface SeasonStandingDTO {
  seasonId: string;
  seasonName: string;
  xp: number;
  /** Rank on the SEASON_XP board, null while unranked. */
  rank: number | null;
  rankedPlayers: number;
}

export interface MatchHistoryDTO {
  matchId: string;
  outcome: 'EXTRACTED' | 'DIED' | 'TIMEOUT' | 'ABANDONED';
  kills: number;
  lootValueCents: Cents;
  securedValueCents: Cents;
  survivedMs: number;
  xp: number;
  createdAt: string;
}

export interface ProfileDTO {
  user: UserDTO;
  stats: PlayerStatsDTO;
  season: SeasonStandingDTO | null;
  recentMatches: MatchHistoryDTO[];
}

/** Public, non-secret runtime configuration (GET /config). */
export interface PublicConfigDTO {
  token: {
    enabled: boolean;
    status: 'COMING_SOON' | 'COMMUNITY';
    symbol: string;
    chain: string;
  };
  currency: {
    code: string;
    mode: 'TEST' | 'LIVE';
  };
}

/** Live population from the game server (GET /status). Null values = unknown, never guessed. */
export interface ServerStatusDTO {
  available: boolean;
  onlinePlayers: number | null;
  activeMatches: number | null;
}

export interface SeasonItemDTO {
  itemId: ItemId;
  name: string;
  rarity: Rarity;
  maxSupply: number | null;
  currentSupply: number;
}

export interface SeasonDTO {
  id: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  specialItems: SeasonItemDTO[];
}

export interface WalletDTO {
  address: string;
  chain: string;
  provider: string;
  balance: number;
}

export interface ApiError {
  error: string;
  message: string;
}
