import { Button, Spinner } from '@extract/ui';
import type { HudState } from '../net/GameClient';

export function Matchmaking({ hud, onCancel }: { hud: HudState; onCancel: () => void }) {
  const lobby = hud.lobby;
  const starting = lobby?.phase === 'STARTING' && lobby.countdownMs !== null;
  const countdown = starting ? Math.max(1, Math.ceil((lobby.countdownMs ?? 0) / 1000)) : null;
  return (
    <div className="matchmaking">
      <div className="mm-card">
        <p className="mm-kicker">FIND MATCH</p>
        {!lobby && <Spinner label={hud.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'} />}
        {lobby && !starting && (
          <>
            <Spinner label="Searching…" />
            <p className="mm-found">
              PLAYERS FOUND <b>{lobby.found}</b> / {lobby.target}
            </p>
            <div className="mm-bar">
              <i style={{ width: `${(lobby.found / Math.max(1, lobby.target)) * 100}%` }} />
            </div>
            <p className="mm-note">{lobby.humans} human{lobby.humans === 1 ? '' : 's'} · empty slots are filled with bots</p>
          </>
        )}
        {starting && (
          <>
            <p className="mm-found">
              PLAYERS FOUND <b>{lobby.found}</b> / {lobby.target}
            </p>
            <p className="mm-starting">STARTING IN</p>
            <p key={countdown} className="mm-countdown">
              {countdown}
            </p>
          </>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ul className="mm-tips">
        <li><kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>Click</kbd> shoot</li>
        <li><kbd>E</kbd> loot / open · <kbd>R</kbd> reload · <kbd>Space</kbd> dash · <kbd>1-3</kbd> weapons</li>
        <li><kbd>Tab</kbd> inventory · <kbd>M</kbd> map · <kbd>H</kbd> medkit · <kbd>G</kbd> armor plate</li>
      </ul>
    </div>
  );
}
