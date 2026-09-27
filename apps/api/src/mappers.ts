import type {
  InventoryItem,
  ItemDefinitionRow,
  MarketplaceListing,
  MarketplaceTransaction,
  PlayerProfile,
  Season,
  User,
} from '@extract/database';
import type {
  InventoryItemDTO,
  ItemType,
  ListingDTO,
  Rarity,
  TransactionDTO,
  UserDTO,
} from '@extract/game-types';

export function toUserDTO(user: User & { profile: PlayerProfile | null }): UserDTO {
  return {
    id: user.id,
    username: user.username,
    isGuest: user.isGuest,
    balanceCents: user.profile?.balanceCents ?? 0,
    walletAddress: user.walletAddress,
    walletChain: user.walletChain,
    createdAt: user.createdAt.toISOString(),
  };
}

export type InventoryRow = InventoryItem & { itemDefinition: ItemDefinitionRow; season: Season | null };

export function toInventoryItemDTO(row: InventoryRow): InventoryItemDTO {
  const def = row.itemDefinition;
  return {
    id: row.id,
    itemId: def.id,
    name: def.name,
    type: def.type as ItemType,
    rarity: def.rarity as Rarity,
    icon: def.icon,
    quantity: row.quantity,
    estimatedValue: def.estimatedValueCents,
    acquiredAt: row.acquiredAt.toISOString(),
    seasonId: row.seasonId,
    seasonName: row.season?.name ?? null,
    serialNumber: row.serialNumber,
    maxSupply: def.maxSupply,
    status: row.status,
    blockchain: row.mintAddress
      ? {
          chain: row.chain ?? 'unknown',
          mintAddress: row.mintAddress,
          tokenId: row.tokenId,
          blockchainAssetId: row.blockchainAssetId,
          ownerWallet: row.ownerWallet,
        }
      : null,
  };
}

export type ListingRow = MarketplaceListing & {
  seller: { username: string };
  itemDefinition: ItemDefinitionRow;
  inventoryItem: InventoryItem;
};

export function toListingDTO(l: ListingRow): ListingDTO {
  return {
    id: l.id,
    itemId: l.itemDefinitionId,
    name: l.itemName,
    rarity: l.rarity as Rarity,
    icon: l.itemDefinition.icon,
    quantity: l.quantity,
    priceCents: l.priceCents,
    estimatedValue: l.itemDefinition.estimatedValueCents * l.quantity,
    sellerId: l.sellerId,
    sellerName: l.seller.username,
    status: l.status,
    serialNumber: l.inventoryItem.serialNumber,
    maxSupply: l.itemDefinition.maxSupply,
    createdAt: l.createdAt.toISOString(),
  };
}

export type TransactionRow = MarketplaceTransaction & {
  listing: MarketplaceListing;
  buyer: { username: string };
  seller: { username: string };
};

export function toTransactionDTO(t: TransactionRow, viewerId: string): TransactionDTO {
  const role = t.buyerId === viewerId ? 'buyer' : 'seller';
  return {
    id: t.id,
    listingId: t.listingId,
    itemName: t.listing.itemName,
    rarity: t.listing.rarity as Rarity,
    quantity: t.listing.quantity,
    priceCents: t.priceCents,
    feeCents: t.feeCents,
    sellerProceedsCents: t.sellerProceedsCents,
    role,
    counterparty: role === 'buyer' ? t.seller.username : t.buyer.username,
    createdAt: t.createdAt.toISOString(),
  };
}
