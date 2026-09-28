import type { ServerStatusDTO } from '@extract/game-types';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const POLL_MS = 15_000;

/** Online players + active matches from the game server; renders nothing while unknown. */
export function LiveStats() {
  const [status, setStatus] = useState<ServerStatusDTO | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .status()
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus(null));
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (!status?.available || status.onlinePlayers === null || status.activeMatches === null) return null;
  return (
    <div className="live-stats" aria-label="Live server status">
      <div className="live-stats__item">
        <span className="x-chip x-chip--live">ONLINE</span>
        <b>{status.onlinePlayers.toLocaleString('en-US')}</b>
        <small>{status.onlinePlayers === 1 ? 'PLAYER' : 'PLAYERS'}</small>
      </div>
      <div className="live-stats__item">
        <b>{status.activeMatches.toLocaleString('en-US')}</b>
        <small>{status.activeMatches === 1 ? 'ACTIVE RAID' : 'ACTIVE RAIDS'}</small>
      </div>
    </div>
  );
}
