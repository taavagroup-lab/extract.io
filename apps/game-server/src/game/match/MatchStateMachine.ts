import { MATCH_CONFIG } from '@extract/game-config';
import { MATCH_PHASES, type MatchPhase } from '@extract/game-types';

export type PhaseListener = (phase: MatchPhase, prev: MatchPhase) => void;

const order = (p: MatchPhase): number => MATCH_PHASES.indexOf(p);

/**
 * WAITING -> STARTING -> LOOT_PHASE -> COMBAT_PHASE -> EXTRACTION_PHASE -> FINISHED
 *
 * The only place that decides phase transitions. Phases advance strictly in
 * order; skipping time (dev tools) still fires every intermediate hook.
 */
export class MatchStateMachine {
  private current: MatchPhase = 'WAITING';
  private countdownEndsAt: number | null = null;
  private startedAt: number | null = null;
  private offsetMs = 0;

  constructor(
    private readonly onEnter: PhaseListener,
    private readonly schedule = MATCH_CONFIG.phases,
    private readonly durationMs: number = MATCH_CONFIG.durationMs,
  ) {}

  get phase(): MatchPhase {
    return this.current;
  }

  get isLobby(): boolean {
    return this.current === 'WAITING' || this.current === 'STARTING';
  }

  get isActive(): boolean {
    return this.current === 'LOOT_PHASE' || this.current === 'COMBAT_PHASE' || this.current === 'EXTRACTION_PHASE';
  }

  get isFinished(): boolean {
    return this.current === 'FINISHED';
  }

  /** Match time (ms since LOOT_PHASE began). */
  matchTime(now: number): number {
    return this.startedAt === null ? 0 : now - this.startedAt + this.offsetMs;
  }

  countdownRemaining(now: number): number | null {
    return this.countdownEndsAt === null ? null : Math.max(0, this.countdownEndsAt - now);
  }

  beginCountdown(now: number, ms: number = MATCH_CONFIG.countdownMs): void {
    if (this.current !== 'WAITING') return;
    this.countdownEndsAt = now + ms;
    this.transition('STARTING');
  }

  update(now: number): void {
    if (this.current === 'STARTING' && this.countdownEndsAt !== null && now >= this.countdownEndsAt) {
      this.startedAt = now;
      this.transition('LOOT_PHASE');
    }
    if (!this.isActive) return;
    const t = this.matchTime(now);
    for (const step of this.schedule) {
      if (t >= step.startMs && order(step.phase) > order(this.current)) this.transition(step.phase);
    }
    if (t >= this.durationMs) this.transition('FINISHED');
  }

  /** Dev tool: jump the match clock. */
  setMatchTime(now: number, ms: number): void {
    if (this.startedAt === null) return;
    this.offsetMs = ms - (now - this.startedAt);
  }

  finish(): void {
    if (this.current !== 'FINISHED') this.transition('FINISHED');
  }

  private transition(next: MatchPhase): void {
    if (next === this.current || order(next) < order(this.current)) return;
    const prev = this.current;
    this.current = next;
    this.onEnter(next, prev);
  }
}
