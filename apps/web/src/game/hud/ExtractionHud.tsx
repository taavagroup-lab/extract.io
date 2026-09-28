import { EXTRACTION_CONFIG } from '@extract/game-config';
import { Usdc } from '../../components/Brand';
import type { GameClient, HudState } from '../net/GameClient';

const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;
/** Map units -> metres for the HUD distance readout (display only). */
const METERS_PER_UNIT = 0.1;

/** Countdown ring while extracting: time left, bag value, and what cancels it. */
export function ExtractionProgress({ hud }: { hud: HudState }) {
  const s = hud.self;
  const x = s?.extraction;
  if (!s || !x) return null;
  const secs = x.remainingMs / 1000;
  return (
    <div className={`hud-extract ${secs <= 3 ? 'is-final' : ''}`} role="status">
      <svg className="hud-extract__ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={RING_R} className="hud-extract__track" />
        <circle cx="50" cy="50" r={RING_R} className="hud-extract__arc" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - x.progress)} />
      </svg>
      <div className="hud-extract__center">
        <span className="hud-extract__label">EXTRACTING</span>
        <b className="hud-extract__time">{secs.toFixed(1)}s</b>
      </div>
      <div className="hud-extract__side">
        <span className="hud-extract__label">BAG VALUE</span>
        <Usdc cents={s.bagValue} className="hud-extract__bag" />
        <small>Hold the zone{EXTRACTION_CONFIG.cancelOnDamage ? ' · damage cancels' : ''}</small>
      </div>
    </div>
  );
}

const REASONS: Record<string, string> = {
  'Took damage': 'YOU TOOK DAMAGE',
  'Left the extraction zone': 'YOU LEFT THE ZONE',
};

/** Big, unmistakable feedback when an extraction is interrupted. */
export function ExtractionInterrupted({ hud }: { hud: HudState }) {
  const i = hud.extractInterrupt;
  if (!i || hud.self?.extraction) return null;
  return (
    <div key={i.at} className="hud-interrupt" role="alert">
      <strong>EXTRACTION INTERRUPTED</strong>
      <span>{REASONS[i.reason] ?? i.reason.toUpperCase()}</span>
    </div>
  );
}

/** Direction + distance to the nearest open extraction zone. */
export function ExtractBeacon({ client, hud }: { client: GameClient; hud: HudState }) {
  const zones = hud.global?.extractionZones.filter((z) => z.active) ?? [];
  if (zones.length === 0 || !client.predictionReady || hud.self?.extraction) return null;
  const px = client.renderX;
  const py = client.renderY;
  let best = zones[0]!;
  let bestD = Infinity;
  for (const z of zones) {
    const d = Math.hypot(z.position.x - px, z.position.y - py);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  const inside = bestD <= best.radius;
  const angle = Math.atan2(best.position.y - py, best.position.x - px);
  return (
    <div className={`hud-beacon ${inside ? 'is-inside' : ''}`}>
      <i className="hud-beacon__arrow" style={{ transform: `rotate(${angle}rad)` }} aria-hidden="true" />
      <span className="hud-beacon__name">{best.name.toUpperCase()}</span>
      <b className="hud-beacon__dist">{inside ? 'IN ZONE' : `${Math.max(1, Math.round((bestD - best.radius) * METERS_PER_UNIT))} m`}</b>
    </div>
  );
}
