import type { LeaderboardCategory, LeaderboardDTO, LeaderboardPeriod } from '@extract/game-types';
import { formatCents } from '@extract/shared';
import { EmptyState, Panel, Spinner, Tabs } from '@extract/ui';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { PageShell } from './PageShell';

const CATEGORIES: { value: LeaderboardCategory; label: string; money: boolean }[] = [
  { value: 'MOST_KILLS', label: 'Most Kills', money: false },
  { value: 'MOST_EXTRACTIONS', label: 'Most Extractions', money: false },
  { value: 'HIGHEST_LOOT_EXTRACTED', label: 'Loot Extracted', money: true },
  { value: 'HIGHEST_SINGLE_EXTRACTION', label: 'Best Extraction', money: true },
  { value: 'HIGHEST_KILL_STREAK', label: 'Kill Streak', money: false },
  { value: 'BOUNTY_KILLS', label: 'Bounty Kills', money: false },
];

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'SEASON', label: 'Season' },
  { value: 'ALL_TIME', label: 'All time' },
];

export function LeaderboardPage() {
  const { user } = useStore(session);
  const [category, setCategory] = useState<LeaderboardCategory>('MOST_KILLS');
  const [period, setPeriod] = useState<LeaderboardPeriod>('SEASON');
  const [data, setData] = useState<LeaderboardDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .leaderboard(category, period)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load leaderboard'));
  }, [category, period]);

  const money = CATEGORIES.find((c) => c.value === category)?.money ?? false;

  return (
    <PageShell title="Leaderboard">
      <div className="lb-controls">
        <Tabs value={category} onChange={setCategory} options={CATEGORIES} />
        <Tabs value={period} onChange={setPeriod} options={PERIODS} />
      </div>
      <Panel title={`Top 100 · ${PERIODS.find((p) => p.value === period)?.label}${data ? ` · ${data.periodKey}` : ''}`}>
        {error && <p className="form-error">{error}</p>}
        {!data && !error && <Spinner label="Loading" />}
        {data && data.rows.length === 0 && <EmptyState title="No entries yet">Play a match to get on the board.</EmptyState>}
        {data && data.rows.length > 0 && (
          <div className="table-wrap">
            <table className="table lb-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Player</th>
                  <th className="num">{CATEGORIES.find((c) => c.value === category)?.label}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.userId} className={r.userId === user?.id ? 'is-me' : ''}>
                    <td className={`num rank rank-${r.rank}`}>{r.rank}</td>
                    <td>{r.username}</td>
                    <td className="num">{money ? formatCents(r.value) : r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
