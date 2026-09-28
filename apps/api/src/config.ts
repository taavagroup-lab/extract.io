import { CURRENCY_DEFAULTS, CURRENCY_MODES, TOKEN_DEFAULTS, TOKEN_STATUSES, type CurrencyMode, type TokenStatus } from '@extract/game-config';
import type { PublicConfigDTO } from '@extract/game-types';
import { envBool, envInt, envStr, isProduction, requireJwtSecret } from '@extract/server-core';

export interface ApiConfig {
  port: number;
  jwtSecret: string;
  corsOrigins: string[];
  blockchainProvider: string;
  production: boolean;
  rateLimitPerMinute: number;
  trustProxy: boolean;
  /** Game server population endpoint (GET, JSON). Null disables /status. */
  gameStatusUrl: string | null;
  /** Non-secret values the web client may read (GET /config). */
  publicConfig: PublicConfigDTO;
  /** Set when an unsafe CURRENCY_MODE was requested and downgraded. */
  warnings: string[];
}

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** ws://host:3002/ws -> http://host:3002/status */
export function statusUrlFromGameServerUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/status';
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function loadApiConfig(): ApiConfig {
  const warnings: string[] = [];
  const blockchainProvider = envStr('BLOCKCHAIN_PROVIDER', 'mock');
  let currencyMode = pick<CurrencyMode>(envStr('CURRENCY_MODE', CURRENCY_DEFAULTS.mode), CURRENCY_MODES, CURRENCY_DEFAULTS.mode);
  if (currencyMode === 'LIVE' && blockchainProvider === 'mock') {
    // Real-money formatting on top of the mock economy would misrepresent test balances.
    warnings.push('CURRENCY_MODE=LIVE ignored: BLOCKCHAIN_PROVIDER is mock, values stay TEST USDC');
    currencyMode = 'TEST';
  }
  const explicitStatusUrl = envStr('GAME_SERVER_STATUS_URL', '');
  return {
    port: envInt('API_PORT', 3001),
    jwtSecret: requireJwtSecret(),
    corsOrigins: envStr('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    blockchainProvider,
    production: isProduction(),
    rateLimitPerMinute: envInt('API_RATE_LIMIT_PER_MINUTE', 600),
    trustProxy: envBool('TRUST_PROXY', false),
    gameStatusUrl: explicitStatusUrl || statusUrlFromGameServerUrl(envStr('GAME_SERVER_URL', 'ws://localhost:3002/ws')),
    publicConfig: {
      token: {
        enabled: envBool('TOKEN_FEATURE_ENABLED', TOKEN_DEFAULTS.enabled),
        status: pick<TokenStatus>(envStr('TOKEN_STATUS', TOKEN_DEFAULTS.status), TOKEN_STATUSES, TOKEN_DEFAULTS.status),
        symbol: envStr('TOKEN_SYMBOL', TOKEN_DEFAULTS.symbol).slice(0, 16),
        chain: envStr('TOKEN_CHAIN', TOKEN_DEFAULTS.chain).slice(0, 24),
      },
      currency: { code: CURRENCY_DEFAULTS.code, mode: currencyMode },
    },
    warnings,
  };
}
