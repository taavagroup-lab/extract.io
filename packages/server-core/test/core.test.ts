import { describe, expect, it } from 'vitest';
import { AnalyticsBus, MemoryAnalyticsSink, signAccessToken, verifyAccessToken } from '../src';

const SECRET = 'test-secret-test-secret-test-secret!!';

describe('access tokens', () => {
  it('round-trips a signed token', () => {
    const token = signAccessToken({ userId: 'u1', username: 'Alice' }, SECRET);
    expect(verifyAccessToken(token, SECRET)).toEqual({ userId: 'u1', username: 'Alice' });
  });

  it('rejects tampered tokens and wrong secrets', () => {
    const token = signAccessToken({ userId: 'u1', username: 'Alice' }, SECRET);
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', username: 'Admin', iss: 'extract.io' })).toString('base64url');
    expect(verifyAccessToken(`${h}.${forged}.${s}`, SECRET)).toBeNull();
    expect(verifyAccessToken(token, `${SECRET}x`)).toBeNull();
    expect(verifyAccessToken(`${h}.${p}.`, SECRET)).toBeNull();
    expect(verifyAccessToken('garbage', SECRET)).toBeNull();
  });
});

describe('analytics bus', () => {
  it('delivers events to sinks and listeners; sink errors never propagate', () => {
    const errors: unknown[] = [];
    const sink = new MemoryAnalyticsSink();
    const bus = new AnalyticsBus((e) => errors.push(e))
      .addSink(sink)
      .addSink({
        handle() {
          throw new Error('broken sink');
        },
      });
    const seen: string[] = [];
    const off = bus.on('PLAYER_EXTRACTED', (e) => seen.push(String(e.props.userId)));
    bus.track('PLAYER_EXTRACTED', { userId: 'u1' });
    bus.track('ITEM_FOUND', { itemId: 'gold_bar' });
    off();
    bus.track('PLAYER_EXTRACTED', { userId: 'u2' });
    expect(seen).toEqual(['u1']);
    expect(sink.counts.PLAYER_EXTRACTED).toBe(2);
    expect(sink.counts.ITEM_FOUND).toBe(1);
    expect(errors).toHaveLength(3);
  });
});
