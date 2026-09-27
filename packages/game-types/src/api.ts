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
}

export interface PlayerStatsDTO {
  totalMatches: number;
  totalKills: number;
  totalDeaths: number;
  totalExtractions: number;
  totalLootExtractedCents: Cents;
  highestSingleExtractionCents: Cents;
  highestKillStreak: number;
  bountyKills: number;
  bountyEarnedCents: Cents;
}

export interface MatchHistoryDTO {
  matchId: string;
  outcome: 'EXTRACTED' | 'DIED' | 'TIMEOUT' | 'ABANDONED';
  kills: number;
  lootValueCents: Cents;
  securedValueCents: Cents;
  survivedMs: number;
  createdAt: string;
}

export interface ProfileDTO {
  user: UserDTO;
  stats: PlayerStatsDTO;
  recentMatches: MatchHistoryDTO[];
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
