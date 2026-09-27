-- CreateEnum
CREATE TYPE "ItemRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('WEAPON', 'AMMO', 'CONSUMABLE', 'VALUABLE', 'COSMETIC');

-- CreateEnum
CREATE TYPE "InventoryItemStatus" AS ENUM ('OWNED', 'LISTED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "MatchOutcome" AS ENUM ('EXTRACTED', 'DIED', 'TIMEOUT', 'ABANDONED');

-- CreateEnum
CREATE TYPE "LeaderboardCategory" AS ENUM ('MOST_KILLS', 'MOST_EXTRACTIONS', 'HIGHEST_LOOT_EXTRACTED', 'HIGHEST_SINGLE_EXTRACTION', 'HIGHEST_KILL_STREAK', 'BOUNTY_KILLS');

-- CreateEnum
CREATE TYPE "LeaderboardPeriod" AS ENUM ('WEEKLY', 'SEASON', 'ALL_TIME');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "usernameLower" TEXT NOT NULL,
    "passwordHash" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT true,
    "walletAddress" TEXT,
    "walletChain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "totalMatches" INTEGER NOT NULL DEFAULT 0,
    "totalKills" INTEGER NOT NULL DEFAULT 0,
    "totalDeaths" INTEGER NOT NULL DEFAULT 0,
    "totalExtractions" INTEGER NOT NULL DEFAULT 0,
    "totalLootExtractedCents" INTEGER NOT NULL DEFAULT 0,
    "highestSingleExtractionCents" INTEGER NOT NULL DEFAULT 0,
    "highestKillStreak" INTEGER NOT NULL DEFAULT 0,
    "bountyKills" INTEGER NOT NULL DEFAULT 0,
    "bountyEarnedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ItemCategory" NOT NULL,
    "rarity" "ItemRarity" NOT NULL,
    "stackable" BOOLEAN NOT NULL,
    "maxStack" INTEGER NOT NULL,
    "estimatedValueCents" INTEGER NOT NULL,
    "icon" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "persistable" BOOLEAN NOT NULL DEFAULT true,
    "seasonId" TEXT,
    "maxSupply" INTEGER,
    "currentSupply" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "InventoryItemStatus" NOT NULL DEFAULT 'OWNED',
    "seasonId" TEXT,
    "serialNumber" INTEGER,
    "sourceMatchId" TEXT,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockchainAssetId" TEXT,
    "mintAddress" TEXT,
    "tokenId" TEXT,
    "chain" TEXT,
    "ownerWallet" TEXT,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "mapId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "playerCount" INTEGER NOT NULL DEFAULT 0,
    "botCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayer" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" "MatchOutcome" NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "damageDealt" INTEGER NOT NULL DEFAULT 0,
    "lootValueCents" INTEGER NOT NULL DEFAULT 0,
    "securedValueCents" INTEGER NOT NULL DEFAULT 0,
    "lostValueCents" INTEGER NOT NULL DEFAULT 0,
    "bountyEarnedCents" INTEGER NOT NULL DEFAULT 0,
    "survivedMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kill" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "killerUserId" TEXT,
    "victimUserId" TEXT,
    "killerName" TEXT,
    "victimName" TEXT NOT NULL,
    "weaponId" TEXT,
    "wasBountyKill" BOOLEAN NOT NULL DEFAULT false,
    "bountyCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extractionPointId" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "survivedMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "rarity" "ItemRarity" NOT NULL,
    "rarityRank" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceTransaction" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "sellerProceedsCents" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardEntry" (
    "userId" TEXT NOT NULL,
    "category" "LeaderboardCategory" NOT NULL,
    "period" "LeaderboardPeriod" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "seasonId" TEXT,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("userId","category","period","periodKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_usernameLower_key" ON "User"("usernameLower");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_userId_key" ON "PlayerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_userId_key" ON "Inventory"("userId");

-- CreateIndex
CREATE INDEX "InventoryItem_inventoryId_status_idx" ON "InventoryItem"("inventoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_itemDefinitionId_serialNumber_key" ON "InventoryItem"("itemDefinitionId", "serialNumber");

-- CreateIndex
CREATE INDEX "MatchPlayer_userId_createdAt_idx" ON "MatchPlayer"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayer_matchId_userId_key" ON "MatchPlayer"("matchId", "userId");

-- CreateIndex
CREATE INDEX "Kill_matchId_idx" ON "Kill"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "Extraction_matchId_userId_key" ON "Extraction"("matchId", "userId");

-- CreateIndex
CREATE INDEX "MarketplaceListing_status_createdAt_idx" ON "MarketplaceListing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceListing_status_priceCents_idx" ON "MarketplaceListing"("status", "priceCents");

-- CreateIndex
CREATE INDEX "MarketplaceListing_status_rarityRank_idx" ON "MarketplaceListing"("status", "rarityRank");

-- CreateIndex
CREATE INDEX "MarketplaceListing_sellerId_status_idx" ON "MarketplaceListing"("sellerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceTransaction_listingId_key" ON "MarketplaceTransaction"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceTransaction_idempotencyKey_key" ON "MarketplaceTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MarketplaceTransaction_buyerId_idx" ON "MarketplaceTransaction"("buyerId");

-- CreateIndex
CREATE INDEX "MarketplaceTransaction_sellerId_idx" ON "MarketplaceTransaction"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_number_key" ON "Season"("number");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_category_period_periodKey_value_idx" ON "LeaderboardEntry"("category", "period", "periodKey", "value" DESC);

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDefinition" ADD CONSTRAINT "ItemDefinition_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kill" ADD CONSTRAINT "Kill_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kill" ADD CONSTRAINT "Kill_killerUserId_fkey" FOREIGN KEY ("killerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kill" ADD CONSTRAINT "Kill_victimUserId_fkey" FOREIGN KEY ("victimUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceTransaction" ADD CONSTRAINT "MarketplaceTransaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceTransaction" ADD CONSTRAINT "MarketplaceTransaction_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceTransaction" ADD CONSTRAINT "MarketplaceTransaction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Integrity guards (defense in depth on top of conditional updates)
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_balance_non_negative" CHECK ("balanceCents" >= 0);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_price_positive" CHECK ("priceCents" > 0 AND "quantity" > 0);
ALTER TABLE "ItemDefinition" ADD CONSTRAINT "ItemDefinition_supply_within_max" CHECK ("maxSupply" IS NULL OR "currentSupply" <= "maxSupply");
