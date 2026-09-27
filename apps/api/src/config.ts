import { envBool, envInt, envStr, isProduction, requireJwtSecret } from '@extract/server-core';

export interface ApiConfig {
  port: number;
  jwtSecret: string;
  corsOrigins: string[];
  blockchainProvider: string;
  production: boolean;
  rateLimitPerMinute: number;
  trustProxy: boolean;
}

export function loadApiConfig(): ApiConfig {
  return {
    port: envInt('API_PORT', 3001),
    jwtSecret: requireJwtSecret(),
    corsOrigins: envStr('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    blockchainProvider: envStr('BLOCKCHAIN_PROVIDER', 'mock'),
    production: isProduction(),
    rateLimitPerMinute: envInt('API_RATE_LIMIT_PER_MINUTE', 600),
    trustProxy: envBool('TRUST_PROXY', false),
  };
}
