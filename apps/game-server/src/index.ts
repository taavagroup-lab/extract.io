import { getPrisma, isTransientDbError } from '@extract/database';
import { AnalyticsBus, LogAnalyticsSink, createLogger, loadRootEnv } from '@extract/server-core';
import { CollisionWorld, generateMap } from '@extract/shared';
import { createServer } from 'node:http';
import { NavGrid } from './bots/NavGrid';
import { createHttpHandler } from './http/httpHandler';
import { MatchManager } from './matchmaking/MatchManager';
import { Metrics } from './metrics/Metrics';
import { GameSocketServer } from './net/GameSocketServer';
import { MemoryPersistence } from './persistence/MemoryPersistence';
import { PrismaPersistence } from './persistence/PrismaPersistence';
import { ResilientPersistence } from './persistence/ResilientPersistence';
import type { GamePersistence } from './persistence/types';
import { loadServerConfig } from './serverConfig';

loadRootEnv();
const config = loadServerConfig();
const logger = createLogger('game-server');

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaught exception'));

const analytics = new AnalyticsBus((err) => logger.warn({ err }, 'analytics sink failed')).addSink(new LogAnalyticsSink(logger));

let persistence: GamePersistence & { pending?: number; flush?: () => Promise<void> };
if (config.databaseUrl) {
  // Foreign-key races (result before match row) are retried as well.
  const isTransient = (err: unknown) =>
    isTransientDbError(err) || (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2003');
  persistence = new ResilientPersistence(new PrismaPersistence(getPrisma()), logger, { isTransient });
} else {
  logger.warn('DATABASE_URL not set: results are kept in memory only');
  persistence = new MemoryPersistence();
}

const t0 = performance.now();
const map = generateMap();
const nav = new NavGrid(new CollisionWorld(map.obstacles, map.width, map.height));
logger.info(
  { obstacles: map.obstacles.length, crates: map.crates.length, ms: Math.round(performance.now() - t0) },
  `map "${map.name}" ready`,
);

const metrics = new Metrics();
const manager = new MatchManager({ config, map, nav, logger, analytics, persistence, metrics });
const server = createServer(createHttpHandler(manager, metrics, config));
const sockets = new GameSocketServer(server, manager, metrics, logger);

server.listen(config.port, () => {
  logger.info(
    { port: config.port, devTools: config.devTools, targetPlayers: config.targetPlayers, bots: config.fillWithBots },
    `game server listening on ws://localhost:${config.port}/ws`,
  );
  analytics.track('GAME_STARTED', { port: config.port });
});
manager.start();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  manager.stop();
  sockets.close();
  server.close();
  metrics.dispose();
  await persistence.flush?.().catch(() => {});
  if (config.databaseUrl) await getPrisma().$disconnect().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
