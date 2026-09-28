import { Prisma, isUniqueViolation, type PrismaClient, type Tx } from '@extract/database';
import { ECONOMY_CONFIG, RARITY_CONFIG } from '@extract/game-config';
import type { ListingDTO, ListingQuery, Paginated, TransactionDTO } from '@extract/game-types';
import { logEvent, type AnalyticsBus, type Logger } from '@extract/server-core';
import { calculateMarketplaceFee } from '@extract/shared';
import { AppError, badRequest, conflict, notFound, paymentRequired } from '../errors';
import { toListingDTO, toTransactionDTO, type ListingRow, type MarketStats } from '../mappers';

const listingInclude = {
  seller: { select: { username: true } },
  itemDefinition: true,
  inventoryItem: { include: { season: true } },
} satisfies Prisma.MarketplaceListingInclude;

const txInclude = {
  listing: true,
  buyer: { select: { username: true } },
  seller: { select: { username: true } },
} satisfies Prisma.MarketplaceTransactionInclude;

export interface CreateListingInput {
  inventoryItemId: string;
  quantity: number;
  priceCents: number;
}

/**
 * Internal marketplace with TEST USDC.
 *
 * Integrity rules (all enforced inside single DB transactions):
 *  - Listing escrows the inventory row (status LISTED) via a conditional
 *    update, so an item can never be listed or sold twice (no duplication).
 *  - Buying claims the listing with `UPDATE ... WHERE status = 'ACTIVE'`;
 *    concurrent buyers serialize on the row lock and only one wins.
 *  - The buyer is debited with `WHERE balance >= price` (no overdraft, no
 *    double spend); anything failing rolls the whole purchase back.
 *  - MarketplaceTransaction.listingId and .idempotencyKey are UNIQUE, so a
 *    retried request returns the original purchase instead of a second one.
 */
export class MarketplaceService {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger: Logger,
    private readonly analytics: AnalyticsBus,
    private readonly feeBps: number = ECONOMY_CONFIG.marketplace.feeBps,
  ) {}

  async search(q: ListingQuery): Promise<Paginated<ListingDTO>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 24));
    const where: Prisma.MarketplaceListingWhereInput = { status: 'ACTIVE' };
    if (q.search) where.itemName = { contains: q.search, mode: 'insensitive' };
    if (q.rarity) where.rarity = q.rarity;
    const orderBy: Prisma.MarketplaceListingOrderByWithRelationInput[] =
      q.sort === 'price_asc'
        ? [{ priceCents: 'asc' }, { createdAt: 'desc' }]
        : q.sort === 'price_desc'
          ? [{ priceCents: 'desc' }, { createdAt: 'desc' }]
          : q.sort === 'rarity'
            ? [{ rarityRank: 'desc' }, { priceCents: 'asc' }]
            : [{ createdAt: 'desc' }];
    const [total, rows] = await this.db.$transaction([
      this.db.marketplaceListing.count({ where }),
      this.db.marketplaceListing.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: listingInclude }),
    ]);
    return { items: await this.withMarketStats(rows), total, page, pageSize };
  }

  /**
   * Floor (lowest active asking price per unit) and last sale (per unit) for
   * the item definitions on one page: two grouped queries, no per-row lookups.
   */
  async marketStats(itemIds: readonly string[]): Promise<Map<string, MarketStats>> {
    const out = new Map<string, MarketStats>();
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return out;
    const [floors, sales] = await Promise.all([
      this.db.$queryRaw<{ id: string; floor: number }[]>`
        SELECT "itemDefinitionId" AS id, ROUND(MIN("priceCents"::numeric / "quantity"))::int AS floor
        FROM "MarketplaceListing"
        WHERE "status" = 'ACTIVE' AND "itemDefinitionId" IN (${Prisma.join(ids)})
        GROUP BY "itemDefinitionId"`,
      this.db.$queryRaw<{ id: string; last: number }[]>`
        SELECT DISTINCT ON (l."itemDefinitionId") l."itemDefinitionId" AS id, ROUND(t."priceCents"::numeric / l."quantity")::int AS last
        FROM "MarketplaceTransaction" t
        JOIN "MarketplaceListing" l ON l."id" = t."listingId"
        WHERE l."itemDefinitionId" IN (${Prisma.join(ids)})
        ORDER BY l."itemDefinitionId", t."createdAt" DESC`,
    ]);
    for (const id of ids) out.set(id, { floorCents: null, lastSaleCents: null });
    for (const f of floors) out.get(f.id)!.floorCents = f.floor;
    for (const s of sales) out.get(s.id)!.lastSaleCents = s.last;
    return out;
  }

  private async withMarketStats(rows: ListingRow[]): Promise<ListingDTO[]> {
    const stats = await this.marketStats(rows.map((r) => r.itemDefinitionId));
    return rows.map((r) => toListingDTO(r, stats.get(r.itemDefinitionId)));
  }

  async myListings(userId: string): Promise<ListingDTO[]> {
    const rows = await this.db.marketplaceListing.findMany({
      where: { sellerId: userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: listingInclude,
    });
    return this.withMarketStats(rows);
  }

  async history(userId: string): Promise<TransactionDTO[]> {
    const rows = await this.db.marketplaceTransaction.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: txInclude,
    });
    return rows.map((t) => toTransactionDTO(t, userId));
  }

  async createListing(userId: string, input: CreateListingInput): Promise<ListingDTO> {
    const { quantity, priceCents } = input;
    const cfg = ECONOMY_CONFIG.marketplace;
    if (!Number.isInteger(quantity) || quantity < 1) throw badRequest('Quantity must be a positive integer');
    if (!Number.isInteger(priceCents) || priceCents < cfg.minPriceCents || priceCents > cfg.maxPriceCents) {
      throw badRequest('Invalid price');
    }

    const listing = await this.db.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: input.inventoryItemId, inventory: { userId }, status: 'OWNED' },
        include: { itemDefinition: true },
      });
      if (!item) throw notFound('Item not found in your inventory');
      if (!item.itemDefinition.persistable) throw badRequest('This item cannot be traded');
      if (item.mintAddress) throw badRequest('On-chain items are traded on-chain (future feature)');
      if (quantity > item.quantity) throw badRequest('Not enough quantity');
      const active = await tx.marketplaceListing.count({ where: { sellerId: userId, status: 'ACTIVE' } });
      if (active >= cfg.maxActiveListingsPerUser) throw conflict('Too many active listings');

      let escrowId: string;
      if (quantity === item.quantity) {
        const locked = await tx.inventoryItem.updateMany({
          where: { id: item.id, status: 'OWNED', quantity },
          data: { status: 'LISTED' },
        });
        if (locked.count !== 1) throw conflict('Item changed, please retry');
        escrowId = item.id;
      } else {
        const split = await tx.inventoryItem.updateMany({
          where: { id: item.id, status: 'OWNED', quantity: { gt: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (split.count !== 1) throw conflict('Item changed, please retry');
        const escrow = await tx.inventoryItem.create({
          data: {
            inventoryId: item.inventoryId,
            itemDefinitionId: item.itemDefinitionId,
            quantity,
            status: 'LISTED',
            seasonId: item.seasonId,
            sourceMatchId: item.sourceMatchId,
            acquiredAt: item.acquiredAt,
          },
        });
        escrowId = escrow.id;
      }

      return tx.marketplaceListing.create({
        data: {
          sellerId: userId,
          inventoryItemId: escrowId,
          itemDefinitionId: item.itemDefinitionId,
          itemName: item.itemDefinition.name,
          rarity: item.itemDefinition.rarity,
          rarityRank: RARITY_CONFIG[item.itemDefinition.rarity].rank,
          quantity,
          priceCents,
        },
        include: listingInclude,
      });
    });

    logEvent(this.logger, 'marketplace_listing', { listingId: listing.id, sellerId: userId, itemId: listing.itemDefinitionId, quantity, priceCents });
    return toListingDTO(listing);
  }

  async cancelListing(userId: string, listingId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const closed = await tx.marketplaceListing.updateMany({
        where: { id: listingId, sellerId: userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', closedAt: new Date() },
      });
      if (closed.count !== 1) throw notFound('Active listing not found');
      const listing = await tx.marketplaceListing.findUniqueOrThrow({ where: { id: listingId } });
      await this.releaseEscrow(tx, listing.inventoryItemId);
    });
    logEvent(this.logger, 'marketplace_listing_cancelled', { listingId, sellerId: userId });
  }

  /** Returns the escrowed row to the seller's usable inventory. */
  private async releaseEscrow(tx: Tx, inventoryItemId: string): Promise<void> {
    const released = await tx.inventoryItem.updateMany({
      where: { id: inventoryItemId, status: 'LISTED' },
      data: { status: 'OWNED' },
    });
    if (released.count !== 1) throw new AppError(500, 'escrow_missing', 'Escrowed item missing');
  }

  async buy(buyerId: string, listingId: string, idempotencyKey: string): Promise<TransactionDTO> {
    if (!idempotencyKey || idempotencyKey.length > 128) throw badRequest('Missing Idempotency-Key');
    const previous = await this.db.marketplaceTransaction.findUnique({ where: { idempotencyKey }, include: txInclude });
    if (previous) {
      if (previous.buyerId !== buyerId || previous.listingId !== listingId) throw conflict('Idempotency key already used');
      return toTransactionDTO(previous, buyerId);
    }

    let result;
    try {
      result = await this.db.$transaction(async (tx) => {
        const listing = await tx.marketplaceListing.findUnique({ where: { id: listingId } });
        if (!listing) throw notFound('Listing not found');
        if (listing.sellerId === buyerId) throw badRequest('You cannot buy your own listing', 'own_listing');
        if (listing.status !== 'ACTIVE') throw conflict('Listing is no longer available', 'listing_unavailable');

        // 1. Claim the listing (only one concurrent buyer can succeed).
        const claimed = await tx.marketplaceListing.updateMany({
          where: { id: listingId, status: 'ACTIVE' },
          data: { status: 'SOLD', closedAt: new Date() },
        });
        if (claimed.count !== 1) throw conflict('Listing is no longer available', 'listing_unavailable');

        // 2. Debit the buyer; never below zero.
        const debited = await tx.playerProfile.updateMany({
          where: { userId: buyerId, balanceCents: { gte: listing.priceCents } },
          data: { balanceCents: { decrement: listing.priceCents } },
        });
        if (debited.count !== 1) throw paymentRequired('Insufficient TEST USDC balance');

        // 3. Credit the seller (price minus platform fee).
        const fee = calculateMarketplaceFee(listing.priceCents, this.feeBps);
        await tx.playerProfile.update({
          where: { userId: listing.sellerId },
          data: { balanceCents: { increment: fee.sellerProceedsCents } },
        });

        // 4. Transfer the escrowed item.
        const buyerInventory = await tx.inventory.upsert({ where: { userId: buyerId }, create: { userId: buyerId }, update: {} });
        const moved = await tx.inventoryItem.updateMany({
          where: { id: listing.inventoryItemId, status: 'LISTED' },
          data: { inventoryId: buyerInventory.id, status: 'OWNED', acquiredAt: new Date() },
        });
        if (moved.count !== 1) throw new AppError(500, 'escrow_missing', 'Escrowed item missing');

        // 5. Record (UNIQUE listingId + idempotencyKey).
        return tx.marketplaceTransaction.create({
          data: {
            listingId,
            buyerId,
            sellerId: listing.sellerId,
            priceCents: listing.priceCents,
            feeCents: fee.feeCents,
            sellerProceedsCents: fee.sellerProceedsCents,
            idempotencyKey,
          },
          include: txInclude,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await this.db.marketplaceTransaction.findUnique({ where: { idempotencyKey }, include: txInclude });
        if (again && again.buyerId === buyerId) return toTransactionDTO(again, buyerId);
        throw conflict('Listing is no longer available', 'listing_unavailable');
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        throw conflict('Purchase conflicted with another request, please retry', 'retry');
      }
      throw err;
    }

    logEvent(this.logger, 'marketplace_sale', {
      listingId,
      buyerId,
      sellerId: result.sellerId,
      priceCents: result.priceCents,
      feeCents: result.feeCents,
    });
    this.analytics.track('ITEM_SOLD', { listingId, sellerId: result.sellerId, priceCents: result.priceCents, itemId: result.listing.itemDefinitionId });
    this.analytics.track('ITEM_BOUGHT', { listingId, buyerId, priceCents: result.priceCents, itemId: result.listing.itemDefinitionId });
    return toTransactionDTO(result, buyerId);
  }
}
