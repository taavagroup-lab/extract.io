import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { BlockchainProvider } from '@extract/blockchain';
import type { PrismaClient } from '@extract/database';
import { LEADERBOARD_CATEGORIES, LEADERBOARD_PERIODS, RARITIES } from '@extract/game-types';
import { verifyAccessToken, type AccessTokenPayload, type AnalyticsBus, type Logger } from '@extract/server-core';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { ApiConfig } from './config';
import { AppError, unauthorized } from './errors';
import { AuthService } from './services/AuthService';
import { GameDataService, LEADERBOARD_MAX_PAGE_SIZE } from './services/GameDataService';
import { InventoryService } from './services/InventoryService';
import { MarketplaceService } from './services/MarketplaceService';
import { StatusService } from './services/StatusService';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AccessTokenPayload | null;
  }
}

export interface AppDeps {
  config: ApiConfig;
  db: PrismaClient;
  chain: BlockchainProvider;
  logger: Logger;
  analytics: AnalyticsBus;
  /** Injected in tests; defaults to polling config.gameStatusUrl. */
  status?: StatusService;
}

const usernameBody = z.object({ username: z.string() });
const credentialsBody = z.object({ username: z.string(), password: z.string() });
const listingBody = z.object({
  inventoryItemId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(100_000),
  priceCents: z.number().int().min(1),
});
const listingQuery = z.object({
  search: z.string().max(64).optional(),
  rarity: z.enum(RARITIES).optional(),
  sort: z.enum(['price_asc', 'price_desc', 'newest', 'rarity']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
const leaderboardQuery = z.object({
  category: z.enum(LEADERBOARD_CATEGORIES).default('MOST_KILLS'),
  period: z.enum(LEADERBOARD_PERIODS).default('ALL_TIME'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LEADERBOARD_MAX_PAGE_SIZE).default(25),
});
const idParam = z.object({ id: z.string().min(1).max(64) });
const walletBody = z.object({ address: z.string().min(32).max(64).optional() }).default({});

export async function buildApp(deps: AppDeps) {
  const { config, db, chain, logger, analytics } = deps;
  const app = Fastify({ loggerInstance: logger, trustProxy: config.trustProxy });

  const auth = new AuthService(db, config.jwtSecret);
  const marketplace = new MarketplaceService(db, logger, analytics);
  const inventory = new InventoryService(db, chain);
  const data = new GameDataService(db, chain);
  const status = deps.status ?? new StatusService(config.gameStatusUrl);

  await app.register(cors, { origin: config.corsOrigins, credentials: false });
  await app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: '1 minute' });

  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) req.auth = verifyAccessToken(header.slice(7), config.jwtSecret);
  });

  const requireAuth = async (req: FastifyRequest): Promise<void> => {
    if (!req.auth) throw unauthorized();
    const exists = await db.user.findUnique({ where: { id: req.auth.userId }, select: { id: true } });
    if (!exists) throw unauthorized('Session expired');
  };
  const userId = (req: FastifyRequest): string => req.auth!.userId;

  app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation_error', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Too many requests' });
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    logger.error({ err }, 'unhandled API error');
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });

  const strict = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/health', async () => ({ ok: true }));
  app.get('/config', async () => config.publicConfig);
  app.get('/status', async () => status.status());

  // --- auth -----------------------------------------------------------------
  app.post('/auth/guest', strict, async (req) => auth.createGuest(usernameBody.parse(req.body).username));
  app.post('/auth/register', strict, async (req) => {
    const body = credentialsBody.parse(req.body);
    return auth.register(body.username, body.password, req.auth?.userId ?? null);
  });
  app.post('/auth/login', strict, async (req) => {
    const body = credentialsBody.parse(req.body);
    return auth.login(body.username, body.password);
  });
  app.get('/me', { preHandler: requireAuth }, async (req) => auth.me(userId(req)));

  // --- inventory ------------------------------------------------------------
  app.get('/inventory', { preHandler: requireAuth }, async (req) => inventory.list(userId(req)));
  app.post('/inventory/:id/mint', { preHandler: requireAuth }, async (req) => inventory.mint(userId(req), idParam.parse(req.params).id));

  // --- marketplace ----------------------------------------------------------
  app.get('/marketplace/listings', async (req) => marketplace.search(listingQuery.parse(req.query)));
  app.get('/marketplace/my-listings', { preHandler: requireAuth }, async (req) => marketplace.myListings(userId(req)));
  app.get('/marketplace/history', { preHandler: requireAuth }, async (req) => marketplace.history(userId(req)));
  app.post('/marketplace/listings', { preHandler: requireAuth }, async (req, reply) => {
    const listing = await marketplace.createListing(userId(req), listingBody.parse(req.body));
    return reply.status(201).send(listing);
  });
  app.delete('/marketplace/listings/:id', { preHandler: requireAuth }, async (req, reply) => {
    await marketplace.cancelListing(userId(req), idParam.parse(req.params).id);
    return reply.status(204).send();
  });
  app.post('/marketplace/listings/:id/buy', { preHandler: requireAuth, ...strict }, async (req) => {
    const key = req.headers['idempotency-key'];
    return marketplace.buy(userId(req), idParam.parse(req.params).id, typeof key === 'string' ? key : '');
  });

  // --- leaderboard / profile / season ----------------------------------------
  app.get('/leaderboard', async (req) => {
    const q = leaderboardQuery.parse(req.query);
    return data.leaderboard(q.category, q.period, { page: q.page, pageSize: q.pageSize, userId: req.auth?.userId ?? null });
  });
  app.get('/profile', { preHandler: requireAuth }, async (req) => data.profile(userId(req)));
  app.get('/seasons/current', async () => data.currentSeason());

  // --- wallet (optional) ----------------------------------------------------
  app.get('/wallet', { preHandler: requireAuth }, async (req) => ({ wallet: await data.wallet(userId(req)) }));
  app.post('/wallet/connect', { preHandler: requireAuth }, async (req) => data.connectWallet(userId(req), walletBody.parse(req.body ?? {}).address));
  app.delete('/wallet', { preHandler: requireAuth }, async (req, reply) => {
    await data.disconnectWallet(userId(req));
    return reply.status(204).send();
  });

  return app;
}
