import { RARITY_CONFIG, THREAT_CONFIG, getItemDef } from '@extract/game-config';
import type { Rarity } from '@extract/game-types';
import { ItemIcon } from '@extract/ui';
import type { CSSProperties } from 'react';
import { Usdc } from '../../components/Brand';
import type { HudState } from '../net/GameClient';

/** "KINGPIN DETECTED" (someone else) or "YOU ARE THE KINGPIN" (self). */
export function KingpinBanner({ hud }: { hud: HudState }) {
  const k = hud.kingpin;
  if (!k) return null;
  const reveal = THREAT_CONFIG.kingpinReveal.enabled;
  return (
    <div key={k.id} className={`hud-kingpin ${k.self ? 'is-self' : ''}`} role="alert">
      <span className="hud-kingpin__kicker">{k.self ? 'YOUR BAG IS WORTH' : k.name}</span>
      <strong>{k.self ? 'YOU ARE THE KINGPIN' : 'KINGPIN DETECTED'}</strong>
      <span className="hud-kingpin__sub">
        <Usdc cents={k.bagCents} />
        {reveal && <em>{k.self ? ' · your position is being broadcast' : ' · approximate location on the map'}</em>}
      </span>
    </div>
  );
}

/** High value target (bounty) banner for the local player. */
export function BountyBanner({ hud }: { hud: HudState }) {
  const s = hud.self;
  if (!s || s.bountyCents <= 0) return null;
  return (
    <div className="hud-hvt">
      <strong>HIGH VALUE TARGET</strong>
      <span>
        BOUNTY <Usdc cents={s.bountyCents} />
      </span>
    </div>
  );
}

const ACQUIRED: Record<Rarity, string> = {
  COMMON: 'ACQUIRED',
  RARE: 'RARE ACQUIRED',
  EPIC: 'EPIC ACQUIRED',
  LEGENDARY: 'LEGENDARY ACQUIRED',
  MYTHIC: 'MYTHIC ACQUIRED',
};

/** Valuable loot pickups: rarity, name and what it adds to the bag. */
export function LootToasts({ hud }: { hud: HudState }) {
  return (
    <div className="hud-toasts">
      {hud.toasts.map((t) => {
        const def = getItemDef(t.itemId);
        const cfg = RARITY_CONFIG[def.rarity];
        const style = { '--rarity': cfg.color } as CSSProperties;
        return (
          <div key={t.id} className={`hud-toast rarity-${def.rarity.toLowerCase()}`} style={style}>
            <ItemIcon type={def.type} rarity={def.rarity} icon={def.icon} size={44} />
            <div className="hud-toast__text">
              <span className="hud-toast__kicker">{ACQUIRED[def.rarity]}</span>
              <strong>
                {def.name.toUpperCase()}
                {t.qty > 1 ? ` ×${t.qty}` : ''}
              </strong>
              <small>
                + <Usdc cents={t.value} /> BAG VALUE
              </small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
