import { logEvent, type Logger } from '@extract/server-core';
import type {
  GamePersistence,
  KillRecord,
  MatchFinishRecord,
  MatchStartRecord,
  PlayerRunResult,
} from './types';

interface Job {
  label: string;
  run: () => Promise<void>;
  attempts: number;
  nextAt: number;
}

export interface ResilientOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Returns true for errors worth retrying (connection loss etc.). */
  isTransient: (err: unknown) => boolean;
}

const DEFAULTS: ResilientOptions = {
  maxAttempts: 12,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  isTransient: () => true,
};

/**
 * Wraps a persistence implementation so a flaky or briefly unavailable
 * database never blocks or crashes the game loop. Writes are fire-and-forget
 * with exponential-backoff retries; results are idempotent server side
 * (MatchPlayer unique per match+user), so retries cannot duplicate loot.
 */
export class ResilientPersistence implements GamePersistence {
  private readonly queue: Job[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: ResilientOptions;
  /** Serializes jobs so match rows exist before results reference them. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly inner: GamePersistence,
    private readonly logger: Logger,
    opts: Partial<ResilientOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  get pending(): number {
    return this.queue.length;
  }

  async getLimitedSupply(): Promise<Record<string, number>> {
    try {
      return await this.inner.getLimitedSupply();
    } catch (err) {
      this.logger.warn({ err }, 'limited supply unavailable; limited items disabled for this match');
      return {};
    }
  }

  matchStarted(record: MatchStartRecord): Promise<void> {
    return this.enqueue(`matchStarted:${record.matchId}`, () => this.inner.matchStarted(record));
  }

  matchFinished(record: MatchFinishRecord): Promise<void> {
    return this.enqueue(`matchFinished:${record.matchId}`, () => this.inner.matchFinished(record));
  }

  killRecorded(record: KillRecord): Promise<void> {
    return this.enqueue(`kill:${record.matchId}`, () => this.inner.killRecorded(record));
  }

  savePlayerResult(result: PlayerRunResult): Promise<void> {
    return this.enqueue(`result:${result.matchId}:${result.userId}`, () => this.inner.savePlayerResult(result));
  }

  private enqueue(label: string, run: () => Promise<void>): Promise<void> {
    const job: Job = { label, run, attempts: 0, nextAt: 0 };
    const p = (this.chain = this.chain.then(() => this.attempt(job)));
    return p;
  }

  private async attempt(job: Job): Promise<void> {
    job.attempts++;
    try {
      await job.run();
    } catch (err) {
      const transient = this.opts.isTransient(err);
      logEvent(this.logger, 'persistence_error', {
        job: job.label,
        attempt: job.attempts,
        transient,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!transient || job.attempts >= this.opts.maxAttempts) {
        this.logger.error({ job: job.label }, 'persistence job dropped');
        return;
      }
      const delay = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** (job.attempts - 1));
      job.nextAt = Date.now() + delay;
      this.queue.push(job);
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer || this.queue.length === 0) return;
    const next = Math.min(...this.queue.map((j) => j.nextAt));
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = Date.now();
      const due = this.queue.filter((j) => j.nextAt <= now);
      for (const j of due) this.queue.splice(this.queue.indexOf(j), 1);
      for (const j of due) this.chain = this.chain.then(() => this.attempt(j));
      this.chain.then(() => this.schedule());
    }, Math.max(0, next - Date.now()));
  }

  /** Waits for in-flight jobs (tests / graceful shutdown). */
  async flush(): Promise<void> {
    await this.chain;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
