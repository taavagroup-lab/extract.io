import { createBlockchainProvider } from '@extract/blockchain';
import { getPrisma } from '@extract/database';
import { AnalyticsBus, LogAnalyticsSink, createLogger, loadRootEnv } from '@extract/server-core';
import { buildApp } from './app';
import { loadApiConfig } from './config';

loadRootEnv();
const config = loadApiConfig();
const logger = createLogger('api');
const analytics = new AnalyticsBus((err) => logger.warn({ err }, 'analytics sink failed')).addSink(new LogAnalyticsSink(logger));
for (const w of config.warnings) logger.warn(w);
const db = getPrisma();
const chain = createBlockchainProvider(config.blockchainProvider);

const app = await buildApp({ config, db, chain, logger, analytics });

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port, blockchain: chain.name }, `api listening on http://localhost:${config.port}`);
} catch (err) {
  logger.fatal({ err }, 'failed to start api');
  process.exit(1);
}

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await app.close().catch(() => {});
  await db.$disconnect().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
