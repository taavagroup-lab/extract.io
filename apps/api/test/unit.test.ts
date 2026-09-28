import { afterEach, describe, expect, it } from 'vitest';
import { loadApiConfig, statusUrlFromGameServerUrl } from '../src/config';
import { StatusService } from '../src/services/StatusService';

describe('StatusService', () => {
  it('reports live numbers from the game server and caches them', async () => {
    let calls = 0;
    const svc = new StatusService('http://game.test/status', 60_000, 500, async () => {
      calls++;
      return Response.json({ onlinePlayers: 12, activeMatches: 2 });
    });
    expect(await svc.status()).toEqual({ available: true, onlinePlayers: 12, activeMatches: 2 });
    await svc.status();
    expect(calls).toBe(1);
  });

  it('reports unknown instead of guessing when the game server is down or answers garbage', async () => {
    const down = new StatusService('http://game.test/status', 0, 500, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await down.status()).toEqual({ available: false, onlinePlayers: null, activeMatches: null });
    const garbage = new StatusService('http://game.test/status', 0, 500, async () => Response.json({ onlinePlayers: -4 }));
    expect((await garbage.status()).available).toBe(false);
    expect((await new StatusService(null).status()).available).toBe(false);
  });
});

describe('api config', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('derives the status url from the game server url', () => {
    expect(statusUrlFromGameServerUrl('ws://localhost:3002/ws')).toBe('http://localhost:3002/status');
    expect(statusUrlFromGameServerUrl('wss://play.extract.io/ws')).toBe('https://play.extract.io/status');
    expect(statusUrlFromGameServerUrl('not a url')).toBeNull();
  });

  it('keeps TEST currency on the mock economy even if LIVE is requested', () => {
    process.env.CURRENCY_MODE = 'LIVE';
    process.env.BLOCKCHAIN_PROVIDER = 'mock';
    const cfg = loadApiConfig();
    expect(cfg.publicConfig.currency.mode).toBe('TEST');
    expect(cfg.warnings).toHaveLength(1);
  });

  it('reads token identity from the environment and rejects unknown statuses', () => {
    process.env.TOKEN_FEATURE_ENABLED = 'false';
    process.env.TOKEN_STATUS = 'TRADING';
    process.env.TOKEN_SYMBOL = '$EXTRACT';
    const cfg = loadApiConfig();
    expect(cfg.publicConfig.token).toEqual({ enabled: false, status: 'COMING_SOON', symbol: '$EXTRACT', chain: 'Solana' });
  });
});
