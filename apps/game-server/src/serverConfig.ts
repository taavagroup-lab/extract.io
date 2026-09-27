import { MATCH_CONFIG } from '@extract/game-config';
import { envBool, envInt, envStr, isProduction, requireJwtSecret } from '@extract/server-core';

export interface ServerConfig {
  port: number;
  production: boolean;
  devTools: boolean;
  allowAnonymous: boolean;
  targetPlayers: number;
  fillWithBots: boolean;
  lobbyWaitMs: number;
  jwtSecret: string;
  databaseUrl: string | null;
  seasonId: string;
}

export function loadServerConfig(): ServerConfig {
  const production = isProduction();
  const target = envInt('MATCH_TARGET_PLAYERS', MATCH_CONFIG.defaultTargetPlayers);
  return {
    port: envInt('GAME_SERVER_PORT', 3002),
    production,
    // Dev tooling can never be enabled in production.
    devTools: !production && envBool('DEV_TOOLS', true),
    allowAnonymous: !production && envBool('ALLOW_ANONYMOUS_PLAY', true),
    targetPlayers: Math.max(1, Math.min(MATCH_CONFIG.maxPlayers, target)),
    fillWithBots: envBool('MATCH_FILL_WITH_BOTS', true),
    lobbyWaitMs: envInt('LOBBY_WAIT_SECONDS', MATCH_CONFIG.lobbyWaitMs / 1000) * 1000,
    jwtSecret: requireJwtSecret(),
    databaseUrl: process.env.DATABASE_URL ? envStr('DATABASE_URL') : null,
    seasonId: envStr('SEASON_ID', 'season-1'),
  };
}
