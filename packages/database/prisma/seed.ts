/**
 * Seeds reference data: Season 1 and every ItemDefinition from @extract/game-config
 * (the config is the source of truth). Optionally creates a demo market maker
 * with a handful of real listings so the marketplace is not empty on day one.
 */
import { ITEM_DEFINITIONS, RARITY_CONFIG, SEASON_1, getItemDef } from '@extract/game-config';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedSeason(): Promise<void> {
  await prisma.season.upsert({
    where: { id: SEASON_1.id },
    create: {
      id: SEASON_1.id,
      number: SEASON_1.number,
      name: SEASON_1.name,
      startDate: new Date(SEASON_1.startDate),
      endDate: new Date(SEASON_1.endDate),
      isActive: true,
    },
    update: {
      name: SEASON_1.name,
      startDate: new Date(SEASON_1.startDate),
      endDate: new Date(SEASON_1.endDate),
      isActive: true,
    },
  });
}

async function seedItems(): Promise<void> {
  for (const def of ITEM_DEFINITIONS) {
    const data = {
      name: def.name,
      type: def.type,
      rarity: def.rarity,
      stackable: def.stackable,
      maxStack: def.maxStack,
      estimatedValueCents: def.estimatedValue,
      icon: def.icon,
      metadata: JSON.parse(JSON.stringify(def.metadata)) as Prisma.InputJsonObject,
      persistable: def.persistable,
      seasonId: def.seasonId,
      maxSupply: def.maxSupply,
    };
    await prisma.itemDefinition.upsert({ where: { id: def.id }, create: { id: def.id, ...data }, update: data });
  }
}

const DEMO_LISTINGS: { itemId: string; qty: number; priceCents: number }[] = [
  { itemId: 'scrap', qty: 20, priceCents: 120 },
  { itemId: 'medkit', qty: 2, priceCents: 95 },
  { itemId: 'smg', qty: 1, priceCents: 275 },
  { itemId: 'circuit_board', qty: 2, priceCents: 260 },
  { itemId: 'gold_bar', qty: 1, priceCents: 700 },
  { itemId: 'epic_weapon_skin', qty: 1, priceCents: 999 },
  { itemId: 'cyber_katana', qty: 1, priceCents: 4500 },
];

async function seedDemoMarket(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { usernameLower: 'market_maker' } });
  if (existing) return;
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: 'Market_Maker',
        usernameLower: 'market_maker',
        isGuest: false,
        profile: { create: { balanceCents: 0 } },
        inventory: { create: {} },
      },
      include: { inventory: true },
    });
    const inventoryId = user.inventory!.id;
    for (const l of DEMO_LISTINGS) {
      const def = getItemDef(l.itemId);
      const item = await tx.inventoryItem.create({
        data: {
          inventoryId,
          itemDefinitionId: def.id,
          quantity: l.qty,
          status: 'LISTED',
          seasonId: SEASON_1.id,
        },
      });
      await tx.marketplaceListing.create({
        data: {
          sellerId: user.id,
          inventoryItemId: item.id,
          itemDefinitionId: def.id,
          itemName: def.name,
          rarity: def.rarity,
          rarityRank: RARITY_CONFIG[def.rarity].rank,
          quantity: l.qty,
          priceCents: l.priceCents,
        },
      });
    }
  });
  console.log('[seed] demo market maker with', DEMO_LISTINGS.length, 'listings');
}

async function main(): Promise<void> {
  await seedSeason();
  await seedItems();
  if (process.env.SEED_DEMO_MARKET !== 'false') await seedDemoMarket();
  console.log(`[seed] season "${SEASON_1.name}" and ${ITEM_DEFINITIONS.length} item definitions`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
