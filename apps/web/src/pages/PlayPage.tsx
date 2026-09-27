import { Button } from '@extract/ui';
import { useEffect, useMemo, useState } from 'react';
import { DevPanel } from '../game/hud/DevPanel';
import { Hud } from '../game/hud/Hud';
import { InventoryOverlay } from '../game/hud/InventoryOverlay';
import { MapOverlay } from '../game/hud/MapViews';
import { Matchmaking } from '../game/hud/Matchmaking';
import { DeathScreen, ExtractedScreen, MatchEndScreen } from '../game/hud/ResultScreens';
import { useHud } from '../game/hud/useHud';
import { InputController } from '../game/input/InputController';
import { GameClient } from '../game/net/GameClient';
import { ThreeView } from '../game/ThreeView';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { session } from '../lib/session';
import { useStore } from '../lib/store';

type Overlay = 'none' | 'inventory' | 'map';

function GameView({ client, onPlayAgain }: { client: GameClient; onPlayAgain: () => void }) {
  const hud = useHud(client);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [dev, setDev] = useState(false);

  const controls = useMemo(
    () =>
      new InputController(client, {
        toggleInventory: () => setOverlay((o) => (o === 'inventory' ? 'none' : 'inventory')),
        toggleMap: () => setOverlay((o) => (o === 'map' ? 'none' : 'map')),
        toggleDev: () => setDev((d) => !d),
        closeOverlays: () => setOverlay('none'),
      }),
    [client],
  );
  useEffect(() => () => controls.dispose(), [controls]);
  controls.blocked = overlay === 'inventory' || hud.status !== 'playing';

  const finished = hud.status === 'dead' || hud.status === 'extracted' || hud.status === 'ended';
  useEffect(() => {
    // Balance / inventory changed server side: refresh the header user.
    if (finished) {
      const t = window.setTimeout(() => api.me().then((u) => session.setUser(u)).catch(() => {}), 1200);
      return () => window.clearTimeout(t);
    }
  }, [finished]);

  const actions = {
    onPlayAgain,
    onInventory: () => navigate('inventory'),
    onMenu: () => navigate('menu'),
  };

  return (
    <div className="game">
      <ThreeView client={client} controls={controls} />
      {!finished && <Hud client={client} hud={hud} />}
      {!finished && overlay === 'inventory' && <InventoryOverlay client={client} hud={hud} onClose={() => setOverlay('none')} />}
      {!finished && overlay === 'map' && <MapOverlay client={client} onClose={() => setOverlay('none')} />}
      {!finished && dev && hud.devTools && <DevPanel client={client} onClose={() => setDev(false)} />}
      {hud.status === 'reconnecting' && <div className="reconnecting">CONNECTION LOST · RECONNECTING…</div>}
      {hud.status === 'dead' && hud.death && <DeathScreen d={hud.death} {...actions} />}
      {hud.status === 'extracted' && hud.extracted && <ExtractedScreen x={hud.extracted} {...actions} />}
      {hud.status === 'ended' && hud.end && <MatchEndScreen r={hud.end} {...actions} />}
    </div>
  );
}

export function PlayPage() {
  const { token, user } = useStore(session);
  const [round, setRound] = useState(0);
  const [client, setClient] = useState<GameClient | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('menu');
      return;
    }
    const c = new GameClient(token, user?.username ?? 'Guest');
    c.connect();
    setClient(c);
    return () => {
      c.dispose();
      setClient(null);
    };
    // The session user object changes on balance refresh; only token/round start a new client.
  }, [token, round]);

  return <div className="play-page">{client && <PlayInner client={client} onPlayAgain={() => setRound((r) => r + 1)} />}</div>;
}

function PlayInner({ client, onPlayAgain }: { client: GameClient; onPlayAgain: () => void }) {
  const hud = useHud(client);
  if (hud.status === 'error') {
    return (
      <div className="matchmaking">
        <div className="mm-card">
          <p className="mm-kicker">CONNECTION</p>
          <p className="mm-error">{hud.error}</p>
          <div className="result-actions">
            <Button variant="primary" onClick={onPlayAgain}>
              Retry
            </Button>
            <Button variant="ghost" onClick={() => navigate('menu')}>
              Main menu
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (hud.status === 'connecting' || hud.status === 'lobby' || (hud.status === 'reconnecting' && !client.predictionReady)) {
    return <Matchmaking hud={hud} onCancel={() => navigate('menu')} />;
  }
  return <GameView client={client} onPlayAgain={onPlayAgain} />;
}
