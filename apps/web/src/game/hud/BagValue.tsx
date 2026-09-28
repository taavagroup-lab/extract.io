import { THREAT_CONFIG } from '@extract/game-config';
import { formatAmount, threatProgress } from '@extract/shared';
import type { CSSProperties } from 'react';
import { Usdc } from '../../components/Brand';
import type { HudState } from '../net/GameClient';

/**
 * BAG VALUE: what you carry (server-reported) and how dangerous that makes
 * you. Colour and copy come from THREAT_CONFIG; nothing here is balance.
 */
export function BagValue({ hud }: { hud: HudState }) {
  const s = hud.self;
  if (!s) return null;
  const { tier, next, progress } = threatProgress(s.bagValue);
  const kingpin = tier.rank >= THREAT_CONFIG.tiers.find((t) => t.id === THREAT_CONFIG.kingpinReveal.minTier)!.rank;
  const style = { '--tier': tier.color } as CSSProperties;
  return (
    <div className={`hud-bag tier-${tier.id.toLowerCase()} ${kingpin ? 'is-kingpin' : ''}`} style={style}>
      <div className="hud-bag__head">
        <span className="hud-bag__label">BAG VALUE</span>
        {/* Keyed by the gain timestamp so the animation restarts on every gain. */}
        {hud.bagGainAt > 0 && (
          <em key={hud.bagGainAt} className="hud-bag__gain">
            +{formatAmount(hud.bagGain)}
          </em>
        )}
        <span className="hud-bag__tier">{tier.label}</span>
      </div>
      <div key={hud.bagGainAt} className={`hud-bag__value ${hud.bagGainAt > 0 ? 'is-pulse' : ''}`}>
        <Usdc cents={s.bagValue} />
      </div>
      <div className="hud-bag__meter" aria-hidden="true">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="hud-bag__foot">
        {next ? (
          <span>
            {next.label} AT <Usdc cents={next.minCents} />
          </span>
        ) : (
          <span className="hud-bag__warn">{THREAT_CONFIG.kingpinReveal.enabled ? 'POSITION BROADCAST' : 'TOP THREAT TIER'}</span>
        )}
        <kbd>TAB</kbd>
      </div>
      {s.pendingBountyCents > 0 && (
        <p className="hud-bag__bounty">
          + <Usdc cents={s.pendingBountyCents} /> bounty on extract
        </p>
      )}
    </div>
  );
}
