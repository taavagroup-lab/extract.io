import type { BlockchainProvider } from '@extract/blockchain';
import type { PrismaClient } from '@extract/database';
import type { InventoryItemDTO } from '@extract/game-types';
import { badRequest, conflict, notFound } from '../errors';
import { toInventoryItemDTO } from '../mappers';

export class InventoryService {
  constructor(
    private readonly db: PrismaClient,
    private readonly chain: BlockchainProvider,
  ) {}

  /** MY INVENTORY: owned and listed (escrowed) items, newest first. */
  async list(userId: string): Promise<InventoryItemDTO[]> {
    const rows = await this.db.inventoryItem.findMany({
      where: { inventory: { userId }, quantity: { gt: 0 } },
      include: { itemDefinition: true, season: true },
      orderBy: [{ acquiredAt: 'desc' }],
    });
    return rows.map(toInventoryItemDTO);
  }

  /**
   * Optional on-chain step (mock provider in development). Only the owner can
   * mint, only once, and only with a connected wallet.
   */
  async mint(userId: string, inventoryItemId: string): Promise<InventoryItemDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user?.walletAddress) throw badRequest('Connect a wallet first', 'wallet_required');
    const item = await this.db.inventoryItem.findFirst({
      where: { id: inventoryItemId, inventory: { userId }, status: 'OWNED' },
      include: { itemDefinition: true, season: true },
    });
    if (!item) throw notFound('Item not found');
    if (item.mintAddress) throw conflict('Item is already on-chain');
    if (item.itemDefinition.stackable && item.quantity > 1) throw badRequest('Only single items can be minted');

    const minted = await this.chain.mintItem({
      inventoryItemId: item.id,
      ownerAddress: user.walletAddress,
      metadata: {
        name: item.itemDefinition.name,
        rarity: item.itemDefinition.rarity,
        itemId: item.itemDefinitionId,
        serialNumber: item.serialNumber,
        maxSupply: item.itemDefinition.maxSupply,
        seasonId: item.seasonId,
      },
    });
    const updated = await this.db.inventoryItem.updateMany({
      where: { id: item.id, mintAddress: null, status: 'OWNED' },
      data: {
        chain: minted.chain,
        mintAddress: minted.mintAddress,
        tokenId: minted.tokenId,
        blockchainAssetId: minted.blockchainAssetId,
        ownerWallet: user.walletAddress,
      },
    });
    if (updated.count !== 1) throw conflict('Item changed while minting');
    const row = await this.db.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include: { itemDefinition: true, season: true } });
    return toInventoryItemDTO(row);
  }
}
