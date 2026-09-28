import { BRAND } from '@extract/game-config';
import { formatClock } from '@extract/shared';
import { Button } from '@extract/ui';
import { SeasonBadge } from '../../components/Brand';
import type { HudState } from '../net/GameClient';

/**
 * Lobby: raid size, real players vs AI raiders (never presented as humans),
 * and the deploy countdown once the raid is locked.
 */
export function Matchmaking({ hud, onCancel }: { hud: HudState; onCancel: () => void }) {
  const lobby = hud.lobby;
  const starting = lobby?.phase === 'STARTING' && lobby.countdownMs !== null;
  const ai = lobby ? Math.max(0, lobby.found - lobby.humans) : 0;
  const fill = lobby ? Math.min(1, lobby.found / Math.max(1, lobby.target)) : 0;
  return (
    <div className="raid-screen">
      <div className="raid-screen__grid" aria-hidden="true" />
      <div className="raid-card">
        <p className="x-kicker raid-card__kicker">
          <span className={`raid-dot ${starting ? 'is-go' : ''}`} />
          {!lobby ? (hud.status === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING') : starting ? 'RAID LOCKED' : 'FINDING RAID'}
        </p>

        {lobby && (
          <>
            <div className="raid-count">
              <span className="raid-count__label">PLAYERS</span>
              <b>{lobby.found}</b>
              <span className="raid-count__of">/ {lobby.target}</span>
            </div>
            <div className="raid-bar" aria-hidden="true">
              <i style={{ width: `${fill * 100}%` }} />
            </div>
            <div className="raid-split">
              <span>
                <b>{lobby.humans}</b> {lobby.humans === 1 ? 'player' : 'players'}
              </span>
              {ai > 0 && (
                <span>
                  <b>{ai}</b> AI raiders
                </span>
              )}
            </div>
          </>
        )}

        {starting && lobby ? (
          <div className="raid-deploy">
            <span className="x-kicker">DEPLOYING IN</span>
            <b key={Math.ceil((lobby.countdownMs ?? 0) / 1000)}>{formatClock(lobby.countdownMs ?? 0)}</b>
          </div>
        ) : (
          <div className="raid-scan" aria-hidden="true">
            <i />
          </div>
        )}

        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="raid-foot">
        <SeasonBadge compact />
        <p className="raid-slogan">{BRAND.slogan.join(' ')}</p>
        <ul className="raid-tips">
          <li><kbd>WASD</kbd> move <kbd>Mouse</kbd> aim <kbd>Click</kbd> shoot</li>
          <li><kbd>E</kbd> loot <kbd>R</kbd> reload <kbd>Space</kbd> dash <kbd>Tab</kbd> bag <kbd>M</kbd> map</li>
        </ul>
      </div>
    </div>
  );
}
