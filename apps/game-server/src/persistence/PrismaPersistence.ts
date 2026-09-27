import { MatchResultRepository, type Prisma, type PrismaClient } from '@extract/database';
import type {
  GamePersistence,
  KillRecord,
  MatchFinishRecord,
  MatchStartRecord,
  PlayerRunResult,
} from './types';

/** Adapter: game persistence port -> Prisma repository. */
export class PrismaPersistence implements GamePersistence {
  private readonly repo: MatchResultRepository;

  constructor(db: PrismaClient) {
    this.repo = new MatchResultRepository(db);
  }

  getLimitedSupply(): Promise<Record<string, number>> {
    return this.repo.getLimitedSupply();
  }

  matchStarted(record: MatchStartRecord): Promise<void> {
    return this.repo.createMatch(record);
  }

  matchFinished(record: MatchFinishRecord): Promise<void> {
    return this.repo.finishMatch({ ...record, summary: record.summary as Prisma.InputJsonValue });
  }

  killRecorded(record: KillRecord): Promise<void> {
    return this.repo.recordKill(record);
  }

  async savePlayerResult(result: PlayerRunResult): Promise<void> {
    await this.repo.savePlayerResult(result);
  }
}
