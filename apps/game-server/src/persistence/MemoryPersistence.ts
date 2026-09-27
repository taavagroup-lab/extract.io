import type {
  GamePersistence,
  KillRecord,
  MatchFinishRecord,
  MatchStartRecord,
  PlayerRunResult,
} from './types';

/** In-memory persistence for tests and DB-less development. */
export class MemoryPersistence implements GamePersistence {
  readonly matches = new Map<string, { start: MatchStartRecord; finish?: MatchFinishRecord }>();
  readonly kills: KillRecord[] = [];
  readonly results: PlayerRunResult[] = [];

  constructor(private readonly limited: Record<string, number> = { genesis_crown: 1000 }) {}

  async getLimitedSupply(): Promise<Record<string, number>> {
    return { ...this.limited };
  }

  async matchStarted(record: MatchStartRecord): Promise<void> {
    this.matches.set(record.matchId, { start: record });
  }

  async matchFinished(record: MatchFinishRecord): Promise<void> {
    const m = this.matches.get(record.matchId);
    if (m) m.finish = record;
  }

  async killRecorded(record: KillRecord): Promise<void> {
    this.kills.push(record);
  }

  async savePlayerResult(result: PlayerRunResult): Promise<void> {
    // Mirror the DB's (matchId, userId) uniqueness.
    if (this.results.some((r) => r.matchId === result.matchId && r.userId === result.userId)) return;
    this.results.push(result);
  }
}
