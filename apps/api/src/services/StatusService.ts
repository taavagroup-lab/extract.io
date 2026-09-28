import type { ServerStatusDTO } from '@extract/game-types';

const UNKNOWN: ServerStatusDTO = { available: false, onlinePlayers: null, activeMatches: null };

/**
 * Live population, read from the game server's /status endpoint. Cached
 * briefly so menu traffic never fans out to the game server; when the game
 * server is unreachable the numbers are reported as unknown, never guessed.
 */
export class StatusService {
  private cached: { at: number; value: ServerStatusDTO } | null = null;
  private inflight: Promise<ServerStatusDTO> | null = null;

  constructor(
    private readonly url: string | null,
    private readonly ttlMs = 5_000,
    private readonly timeoutMs = 1_500,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async status(): Promise<ServerStatusDTO> {
    if (!this.url) return UNKNOWN;
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.value;
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<ServerStatusDTO> {
    let value = UNKNOWN;
    try {
      const res = await this.fetchImpl(this.url!, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.ok) {
        const body = (await res.json()) as { onlinePlayers?: unknown; activeMatches?: unknown };
        const online = Number(body.onlinePlayers);
        const matches = Number(body.activeMatches);
        if (Number.isInteger(online) && online >= 0 && Number.isInteger(matches) && matches >= 0) {
          value = { available: true, onlinePlayers: online, activeMatches: matches };
        }
      }
    } catch {
      // unreachable / timeout: unknown
    }
    this.cached = { at: Date.now(), value };
    return value;
  }
}
