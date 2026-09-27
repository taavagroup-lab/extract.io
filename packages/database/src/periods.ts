import type { LeaderboardPeriod } from '@extract/game-types';

/** ISO-8601 week key, e.g. "2026-W39". */
export function isoWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKeyFor(period: LeaderboardPeriod, seasonId: string | null, date: Date = new Date()): string {
  switch (period) {
    case 'WEEKLY':
      return isoWeekKey(date);
    case 'SEASON':
      return seasonId ?? 'none';
    case 'ALL_TIME':
      return 'all';
  }
}
