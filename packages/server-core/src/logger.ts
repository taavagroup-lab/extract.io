import pino, { type Logger } from 'pino';
import { isProduction } from './env';

export type { Logger };

/** Structured game/marketplace log events. */
export const LOG_EVENTS = [
  'match_started',
  'player_joined',
  'player_left',
  'player_reconnected',
  'player_killed',
  'item_looted',
  'legendary_found',
  'extraction_started',
  'extraction_cancelled',
  'player_extracted',
  'match_finished',
  'marketplace_listing',
  'marketplace_listing_cancelled',
  'marketplace_sale',
  'supply_drop',
  'bounty_placed',
  'kingpin_detected',
  'persistence_error',
  'security_violation',
] as const;
export type LogEventName = (typeof LOG_EVENTS)[number];

export function createLogger(service: string): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const pretty = !isProduction() && process.env.LOG_FORMAT !== 'json';
  return pino({
    name: service,
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
          },
        }
      : {}),
  });
}

/** Emits a structured event line: { event: "player_killed", ...data }. */
export function logEvent(logger: Logger, event: LogEventName, data: Record<string, unknown> = {}): void {
  logger.info({ event, ...data }, event);
}
