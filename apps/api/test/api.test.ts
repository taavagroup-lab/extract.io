import { MockBlockchainProvider } from '@extract/blockchain';
import { MatchResultRepository, PrismaClient } from '@extract/database';
import { ECONOMY_CONFIG } from '@extract/game-config';
import type { AuthResponse, InventoryItemDTO, ListingDTO, TransactionDTO } from '@extract/game-types';
import { AnalyticsBus, MemoryAnalyticsSink, loadRootEnv } from '@extract/server-core';
import { randomBytes, randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { testDatabaseUrl } from './testDb';

loadRootEnv();
const TEST_DB_URL = testDatabaseUrl();
const createDb = () => new PrismaClient({ datasources: { db: { url: TEST_DB_URL ?? '' } } });

async function dbReachable(): Promise<boolean> {
  if (!TEST_DB_URL) return false;
  const probe = createDb();
  try {
    await probe.$queryRaw`SELECT 1`;
    await probe.itemDefinition.count();
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

const hasDb = await dbReachable();
if (!hasDb) console.warn('[api tests] DATABASE_URL not reachable or not migrated+seeded: integration tests skipped');

describe.skipIf(!hasDb)('API integration (PostgreSQL)', () => {
  const db = createDb();
  const analytics = new AnalyticsBus().addSink(new MemoryAnalyticsSink());
  let app: Awaited<ReturnType<typeof buildApp>>;
  const repo = new MatchResultRepository(db);
  const START = ECONOMY_CONFIG.startingBalanceCents;

  beforeAll(async () => {
    app = await buildApp({
      config: {
        port: 0,
        jwtSecret: 'test-secret-test-secret-test-secret-123',
        corsOrigins: ['http://localhost'],
        blockchainProvider: 'mock',
        production: false,
        rateLimitPerMinute: 100_000,
        trustProxy: false,
      },
      db,
      chain: new MockBlockchainProvider(),
      logger: pino({ level: 'silent' }),
      analytics,
    });
  });

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  const uname = () => `t_${randomBytes(5).toString('hex')}`;
  const guest = async (): Promise<AuthResponse> => {
    const res = await app.inject({ method: 'POST', url: '/auth/guest', payload: { username: uname() } });
    expect(res.statusCode).toBe(200);
    return res.json();
  };
  const authed = (a: AuthResponse) => ({ authorization: `Bearer ${a.token}` });
  const balance = async (userId: string) => (await db.playerProfile.findUniqueOrThrow({ where: { userId } })).balanceCents;
  const inventory = async (a: AuthResponse): Promise<InventoryItemDTO[]> =>
    (await app.inject({ method: 'GET', url: '/inventory', headers: authed(a) })).json();

  /** Grants items through the real extraction persistence path. */
  const extract = async (userId: string, items: { itemId: string; qty: number }[]) => {
    const matchId = `test_${randomUUID()}`;
    await repo.createMatch({ matchId, seasonId: 'season-1', mapId: 'genesis_isle', startedAt: new Date() });
    const value = 1000;
    const input = {
      matchId, userId, seasonId: 'season-1', outcome: 'EXTRACTED' as const, kills: 3, damageDealt: 120, survivedMs: 400_000,
      lootValueCents: value, securedValueCents: value, lostValueCents: 0, bountyEarnedCents: 0, bountyKills: 0, payoutCents: 0,
      items, extraction: { pointId: 'ex_nw', valueCents: value },
    };
    return { matchId, input, result: await repo.savePlayerResult(input) };
  };

  const list = async (a: AuthResponse, inventoryItemId: string, quantity: number, priceCents: number) =>
    app.inject({ method: 'POST', url: '/marketplace/listings', headers: authed(a), payload: { inventoryItemId, quantity, priceCents } });

  const buy = (a: AuthResponse, listingId: string, key: string = randomUUID()) =>
    app.inject({ method: 'POST', url: `/marketplace/listings/${listingId}/buy`, headers: { ...authed(a), 'idempotency-key': key } });

  it('guest login: username only, starting TEST USDC balance, unique names', async () => {
    const a = await guest();
    expect(a.user.isGuest).toBe(true);
    expect(a.user.balanceCents).toBe(START);
    const dup = await app.inject({ method: 'POST', url: '/auth/guest', payload: { username: a.user.username.toUpperCase() } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({ method: 'POST', url: '/auth/guest', payload: { username: 'a b' } });
    expect(bad.statusCode).toBe(400);
    const me = await app.inject({ method: 'GET', url: '/me', headers: authed(a) });
    expect(me.json().id).toBe(a.user.id);
    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
  });

  it('optional registration upgrades the guest and allows password login', async () => {
    const a = await guest();
    const reg = await app.inject({
      method: 'POST', url: '/auth/register', headers: authed(a), payload: { username: a.user.username, password: 'correct horse battery' },
    });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().user.isGuest).toBe(false);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: a.user.username, password: 'correct horse battery' } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.id).toBe(a.user.id);
    const wrong = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: a.user.username, password: 'nope-nope-nope' } });
    expect(wrong.statusCode).toBe(401);
  });

  it('extraction persists loot once (idempotent) and numbers limited items', async () => {
    const a = await guest();
    const before = (await db.itemDefinition.findUniqueOrThrow({ where: { id: 'genesis_crown' } })).currentSupply;
    const { input, result } = await extract(a.user.id, [
      { itemId: 'gold_bar', qty: 2 },
      { itemId: 'cyber_katana', qty: 1 },
      { itemId: 'genesis_crown', qty: 1 },
      { itemId: 'ammo_light', qty: 40 }, // not persistable
    ]);
    expect(result.status).toBe('saved');
    const crown = result.granted.find((g) => g.itemId === 'genesis_crown')!;
    expect(crown.serialNumber).toBe(before + 1);

    const again = await repo.savePlayerResult(input);
    expect(again.status).toBe('duplicate');

    const inv = await inventory(a);
    expect(inv.find((i) => i.itemId === 'gold_bar')?.quantity).toBe(2);
    expect(inv.filter((i) => i.itemId === 'cyber_katana')).toHaveLength(1);
    expect(inv.find((i) => i.itemId === 'genesis_crown')?.serialNumber).toBe(crown.serialNumber);
    expect(inv.find((i) => i.itemId === 'genesis_crown')?.seasonName).toBe('THE GENESIS');
    expect(inv.some((i) => i.itemId === 'ammo_light')).toBe(false);

    const profile = (await app.inject({ method: 'GET', url: '/profile', headers: authed(a) })).json();
    expect(profile.stats.totalExtractions).toBe(1);
    expect(profile.stats.totalKills).toBe(3);

    const lb = (await app.inject({ method: 'GET', url: '/leaderboard?category=MOST_EXTRACTIONS&period=WEEKLY' })).json();
    expect(lb.rows.some((r: { userId: string }) => r.userId === a.user.id)).toBe(true);
  });

  it('marketplace purchase: escrow, 5 % fee, balances and ownership transfer', async () => {
    const seller = await guest();
    const buyer = await guest();
    await extract(seller.user.id, [{ itemId: 'gold_bar', qty: 2 }]);
    const stack = (await inventory(seller)).find((i) => i.itemId === 'gold_bar')!;

    const res = await list(seller, stack.id, 1, 1000);
    expect(res.statusCode).toBe(201);
    const listing: ListingDTO = res.json();
    const sellerInv = await inventory(seller);
    expect(sellerInv.find((i) => i.id === stack.id)?.quantity).toBe(1); // split: one left, one escrowed
    expect(sellerInv.some((i) => i.itemId === 'gold_bar' && i.status === 'LISTED')).toBe(true);

    const search = (await app.inject({ method: 'GET', url: '/marketplace/listings?search=gold&rarity=EPIC&sort=price_asc' })).json();
    expect(search.items.some((l: ListingDTO) => l.id === listing.id)).toBe(true);

    const sellerBefore = await balance(seller.user.id);
    const bought = await buy(buyer, listing.id);
    expect(bought.statusCode).toBe(200);
    const tx: TransactionDTO = bought.json();
    expect(tx.feeCents).toBe(50);
    expect(tx.sellerProceedsCents).toBe(950);
    expect(await balance(buyer.user.id)).toBe(START - 1000);
    expect(await balance(seller.user.id)).toBe(sellerBefore + 950);
    const owned = (await inventory(buyer)).find((i) => i.itemId === 'gold_bar');
    expect(owned?.status).toBe('OWNED');
    expect(owned?.quantity).toBe(1);
  });

  it('prevents duplicate transactions: idempotent retry and concurrent double buying', async () => {
    const seller = await guest();
    const b1 = await guest();
    const b2 = await guest();
    await extract(seller.user.id, [{ itemId: 'cyber_katana', qty: 2 }]);
    const katanas = (await inventory(seller)).filter((i) => i.itemId === 'cyber_katana');
    const l1: ListingDTO = (await list(seller, katanas[0]!.id, 1, 2000)).json();

    // Same Idempotency-Key twice -> one purchase.
    const key = randomUUID();
    const first = await buy(b1, l1.id, key);
    const retry = await buy(b1, l1.id, key);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(first.json().id);
    expect(await balance(b1.user.id)).toBe(START - 2000);

    // Two buyers race for the same listing -> exactly one wins.
    const l2: ListingDTO = (await list(seller, katanas[1]!.id, 1, 1500)).json();
    const [r1, r2] = await Promise.all([buy(b1, l2.id), buy(b2, l2.id)]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const txCount = await db.marketplaceTransaction.count({ where: { listingId: l2.id } });
    expect(txCount).toBe(1);
    const spent = START * 2 - (await balance(b1.user.id)) - (await balance(b2.user.id));
    expect(spent).toBe(2000 + 1500);
    // No duplication: the seller's two katanas still exist exactly twice in total.
    const katanaRows = await db.inventoryItem.findMany({
      where: { itemDefinitionId: 'cyber_katana', inventory: { userId: { in: [b1.user.id, b2.user.id, seller.user.id] } } },
    });
    expect(katanaRows).toHaveLength(2);
    expect(katanaRows.every((r) => r.status === 'OWNED')).toBe(true);
  });

  it('rolls back on insufficient balance and rejects buying your own listing', async () => {
    const seller = await guest();
    const poor = await guest();
    await extract(seller.user.id, [{ itemId: 'quantum_core', qty: 1 }]);
    const core = (await inventory(seller)).find((i) => i.itemId === 'quantum_core')!;
    const listing: ListingDTO = (await list(seller, core.id, 1, START + 1)).json();
    const res = await buy(poor, listing.id);
    expect(res.statusCode).toBe(402);
    expect(await balance(poor.user.id)).toBe(START);
    const still = await db.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(still.status).toBe('ACTIVE');
    expect((await buy(seller, listing.id)).statusCode).toBe(400);
  });

  it('item ownership: cannot list foreign items, cannot double-list, cancel returns the item', async () => {
    const owner = await guest();
    const thief = await guest();
    await extract(owner.user.id, [{ itemId: 'epic_weapon_skin', qty: 1 }]);
    const skin = (await inventory(owner)).find((i) => i.itemId === 'epic_weapon_skin')!;

    expect((await list(thief, skin.id, 1, 500)).statusCode).toBe(404);

    const [a, b] = await Promise.all([list(owner, skin.id, 1, 500), list(owner, skin.id, 1, 600)]);
    const ok = [a, b].filter((r) => r.statusCode === 201);
    expect(ok).toHaveLength(1);
    const listing: ListingDTO = ok[0]!.json();

    const cancel = await app.inject({ method: 'DELETE', url: `/marketplace/listings/${listing.id}`, headers: authed(owner) });
    expect(cancel.statusCode).toBe(204);
    expect((await inventory(owner)).find((i) => i.id === skin.id)?.status).toBe('OWNED');
    const again = await app.inject({ method: 'DELETE', url: `/marketplace/listings/${listing.id}`, headers: authed(owner) });
    expect(again.statusCode).toBe(404);
    expect((await buy(thief, listing.id)).statusCode).toBe(409);
  });

  it('optional wallet: connect (mock) and mint an item', async () => {
    const a = await guest();
    await extract(a.user.id, [{ itemId: 'cyber_katana', qty: 1 }]);
    const katana = (await inventory(a)).find((i) => i.itemId === 'cyber_katana')!;
    const noWallet = await app.inject({ method: 'POST', url: `/inventory/${katana.id}/mint`, headers: authed(a) });
    expect(noWallet.statusCode).toBe(400);
    const wallet = await app.inject({ method: 'POST', url: '/wallet/connect', headers: authed(a), payload: {} });
    expect(wallet.statusCode).toBe(200);
    const minted = await app.inject({ method: 'POST', url: `/inventory/${katana.id}/mint`, headers: authed(a) });
    expect(minted.statusCode).toBe(200);
    expect(minted.json().blockchain.mintAddress).toBeTruthy();
    expect(minted.json().blockchain.ownerWallet).toBe(wallet.json().address);
  });

  it('season endpoint exposes limited supply', async () => {
    const res = await app.inject({ method: 'GET', url: '/seasons/current' });
    expect(res.statusCode).toBe(200);
    const crown = res.json().specialItems.find((i: { itemId: string }) => i.itemId === 'genesis_crown');
    expect(crown.maxSupply).toBe(1000);
  });
});
