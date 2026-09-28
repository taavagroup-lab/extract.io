import { CURRENT_SEASON } from '@extract/game-config';
import type { LeaderboardCategory, LeaderboardDTO, LeaderboardPeriod, LeaderboardRowDTO } from '@extract/game-types';
import { Button, EmptyState, Panel, Spinner, Tabs } from '@extract/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Usdc } from '../components/Brand';
import { ApiError, api } from '../lib/api';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { PageShell } from './PageShell';

type Board = 'SEASON' | 'BIGGEST_BAG' | 'KILLS' | 'EXTRACTIONS' | 'KINGPINS';

const BOARDS: Record<Board, { label: string; category: LeaderboardCategory; column: string; format: (v: number) => ReactNode; blurb: string }> = {
  SEASON: { label: 'Season', category: 'SEASON_XP', column: 'XP', format: (v) => `${v.toLocaleString('en-US')} XP`, blurb: 'Season XP from survival, kills and extractions.' },
  BIGGEST_BAG: { label: 'Biggest bag', category: 'HIGHEST_SINGLE_EXTRACTION', column: 'Best extraction', format: (v) => <Usdc cents={v} />, blurb: 'The most valuable single extraction.' },
  KILLS: { label: 'Kills', category: 'MOST_KILLS', column: 'Kills', format: (v) => v.toLocaleString('en-US'), blurb: 'Total eliminations.' },
  EXTRACTIONS: { label: 'Extractions', category: 'MOST_EXTRACTIONS', column: 'Extractions', format: (v) => v.toLocaleString('en-US'), blurb: 'Raids survived with the bag.' },
  KINGPINS: { label: 'Kingpins', category: 'KINGPIN_EXTRACTIONS', column: 'Kingpin extractions', format: (v) => v.toLocaleString('en-US'), blurb: 'Extractions with a KINGPIN-tier bag.' },
};

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'WEEKLY', label: 'This week' },
  { value: 'SEASON', label: 'Season' },
  { value: 'ALL_TIME', label: 'All time' },
];

const PAGE_SIZE = 25;

function Row({ r, board, me }: { r: LeaderboardRowDTO; board: Board; me: boolean }) {
  return (
    <tr className={`${me ? 'is-me' : ''} ${r.rank <= 3 ? `is-top is-top-${r.rank}` : ''}`}>
      <td className="num rank">{String(r.rank).padStart(2, '0')}</td>
      <td className="lb-player">
        {r.username}
        {me && <span className="x-chip x-chip--accent">You</span>}
      </td>
      <td className="num">{BOARDS[board].format(r.value)}</td>
    </tr>
  );
}

export function LeaderboardPage() {
  const { user } = useStore(session);
  const [board, setBoard] = useState<Board>('SEASON');
  const [period, setPeriod] = useState<LeaderboardPeriod>('SEASON');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeaderboardDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .leaderboard(BOARDS[board].category, period, page, PAGE_SIZE)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Failed to load leaderboard'));
    return () => {
      alive = false;
    };
  }, [board, period, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const meOnPage = !!data?.me && data.rows.some((r) => r.userId === data.me!.userId);

  return (
    <PageShell title="Leaderboard" kicker={`Season ${CURRENT_SEASON.number} · ${CURRENT_SEASON.name}`}>
      <div className="lb-controls">
        <Tabs
          value={board}
          onChange={(b) => {
            setBoard(b);
            setPage(1);
          }}
          options={(Object.keys(BOARDS) as Board[]).map((b) => ({ value: b, label: BOARDS[b].label }))}
        />
        <Tabs
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setPage(1);
          }}
          options={PERIODS}
        />
      </div>
      <Panel
        title={`${BOARDS[board].column} · ${PERIODS.find((p) => p.value === period)?.label}`}
        actions={data && <span className="panel-meta">{data.total.toLocaleString('en-US')} ranked</span>}
      >
        <p className="lb-blurb">{BOARDS[board].blurb}</p>
        {data?.me && !meOnPage && (
          <div className="lb-me">
            <span className="x-kicker">Your rank</span>
            <b>#{data.me.rank}</b>
            <span>{BOARDS[board].format(data.me.value)}</span>
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.ceil(data.me!.rank / PAGE_SIZE))}>
              Jump to me
            </Button>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        {!data && !error && <Spinner label="Loading" />}
        {data && data.rows.length === 0 && <EmptyState title="No entries yet">Play a raid to get on the board.</EmptyState>}
        {data && data.rows.length > 0 && (
          <div className="table-wrap">
            <table className="table lb-table">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Player</th>
                  <th className="num">{BOARDS[board].column}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Row key={r.userId} r={r} board={board} me={r.userId === user?.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && pages > 1 && (
          <div className="pager">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <span>
              {page} / {pages}
            </span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
