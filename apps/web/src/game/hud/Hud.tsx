import { MATCH_CONFIG, PHASE_LABELS, RARITY_CONFIG, WEAPONS, getItemDef, isWeaponId } from '@extract/game-config';
import type { WeaponDefinition } from '@extract/game-types';
import type { CSSProperties } from 'react';
import { formatClock } from '@extract/shared';
import { ItemIcon } from '@extract/ui';
import { Usdc } from '../../components/Brand';
import type { GameClient, HudState } from '../net/GameClient';
import { BountyBanner, KingpinBanner, LootToasts } from './Alerts';
import { BagValue } from './BagValue';
import { ExtractBeacon, ExtractionInterrupted, ExtractionProgress } from './ExtractionHud';
import { Minimap } from './MapViews';
import { useTicker } from './useHud';

const EXTRACTION_OPENS_AT = MATCH_CONFIG.phases.find((p) => p.phase === 'EXTRACTION_PHASE')!.startMs;

/** Owns its own 4 Hz clock so the rest of the HUD does not re-render for it. */
function Timer({ client, hud }: { client: GameClient; hud: HudState }) {
  useTicker(250);
  const g = hud.global;
  if (!g) return null;
  const elapsed = client.serverNow();
  const remaining = Math.max(0, g.durationMs - elapsed);
  const final = elapsed >= MATCH_CONFIG.finalWarningAtMs;
  const extraction = g.phase === 'EXTRACTION_PHASE' || g.extractionZones.some((z) => z.active);
  const untilExtraction = EXTRACTION_OPENS_AT - elapsed;
  return (
    <div className={`hud-timer ${final ? 'hud-timer--final' : ''} ${extraction ? 'is-extract' : ''}`}>
      <span className="hud-timer__value">{formatClock(remaining)}</span>
      <span className="hud-timer__phase">
        {final
          ? 'FINAL MINUTE · EXTRACT NOW'
          : extraction
            ? 'EXTRACTION OPEN'
            : untilExtraction > 0
              ? `EXTRACTION IN ${formatClock(untilExtraction)}`
              : PHASE_LABELS[g.phase]}
      </span>
    </div>
  );
}

function Bar({ value, max, className, label }: { value: number; max: number; className: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`hud-bar ${className}`}>
      <div className="hud-bar__fill" style={{ width: `${pct}%` }} />
      <span className="hud-bar__label">{label}</span>
      <span className="hud-bar__value">{Math.ceil(value)}</span>
    </div>
  );
}

const MODE_LABEL = (def: WeaponDefinition): string =>
  def.fireMode === 'BURST' ? `BURST ×${def.burstCount}` : def.pelletCount > 1 && def.fireMode === 'SEMI' ? 'PUMP' : def.fireMode;

/** Weapon HUD: silhouette, name, fire mode, magazine / reserve, slots, reload. */
function WeaponPanel({ hud }: { hud: HudState }) {
  const s = hud.self;
  if (!s) return null;
  const slot = hud.activeSlot;
  const active = s.weapons[slot];
  const def = active ? WEAPONS[active.weaponId] : null;
  const item = active ? getItemDef(active.itemId) : null;
  const reserve = def ? s.ammo[def.ammoType] : 0;
  const mag = hud.mag ?? active?.mag ?? 0;
  const lowAmmo = def ? mag > 0 && mag <= Math.ceil(def.magazineSize * 0.25) : false;
  const pips = def ? Math.min(def.magazineSize, 30) : 0;
  const filled = def ? Math.round((mag / def.magazineSize) * pips) : 0;
  const rarity = item ? RARITY_CONFIG[item.rarity] : null;
  const style = { '--rarity': rarity?.color ?? 'var(--hud-line)' } as CSSProperties;
  const reload = hud.reload;
  return (
    <div className={`hud-weapon ${hud.weaponPhase === 'SWITCHING' ? 'is-switching' : ''}`} style={style}>
      <div key={active?.uid ?? 'none'} className="hud-weapon__main">
        {item && <ItemIcon type="WEAPON" rarity={item.rarity} icon={item.icon} size={42} />}
        <div className="hud-weapon__id">
          <span className="hud-weapon__name">{def?.name ?? 'Unarmed'}</span>
          {def && (
            <span className="hud-weapon__meta">
              {def.displayName} · <b>{MODE_LABEL(def)}</b>
            </span>
          )}
        </div>
        {def && (
          <span className="hud-weapon__ammo">
            <b key={mag === 0 ? 'empty' : lowAmmo ? `low-${mag}` : 'ok'} className={mag === 0 ? 'is-empty' : lowAmmo ? 'is-low' : ''}>
              {mag}
            </b>
            <small> / {reserve}</small>
          </span>
        )}
      </div>
      {def && (
        <div className={`hud-mag ${def.magazineSize > 30 ? 'is-belt' : ''}`} aria-hidden="true">
          {def.magazineSize > 30 ? (
            <i className="is-full" style={{ width: `${(mag / def.magazineSize) * 100}%` }} />
          ) : (
            Array.from({ length: pips }, (_, i) => <i key={i} className={i < filled ? 'is-full' : ''} />)
          )}
        </div>
      )}
      <div className="hud-weapon__slots">
        {s.weapons.map((w, i) => {
          const d = w ? getItemDef(w.itemId) : null;
          return (
            <span key={i} className={`hud-slot ${i === slot ? 'is-active' : ''} ${w ? '' : 'is-empty'}`} style={d ? ({ '--rarity': RARITY_CONFIG[d.rarity].color } as CSSProperties) : undefined}>
              <kbd>{i + 1}</kbd>
              {w && d ? (
                <>
                  <ItemIcon type="WEAPON" rarity={d.rarity} icon={d.icon} size={18} />
                  <em>{WEAPONS[w.weaponId].name}</em>
                </>
              ) : (
                '—'
              )}
            </span>
          );
        })}
      </div>
      {reload && (
        <div className="hud-progress">
          RELOADING
          <i
            key={reload.key}
            style={{ '--from': `${Math.min(100, reload.progress * 100)}%`, animationDuration: `${Math.max(1, reload.remainingMs)}ms` } as CSSProperties}
          />
        </div>
      )}
      {!reload && def && mag === 0 && (
        <div className="hud-progress hud-progress--empty">{reserve > 0 ? 'EMPTY · PRESS R' : `NO ${def.ammoType.toUpperCase()} AMMO`}</div>
      )}
      {s.useItem && (
        <div className="hud-progress hud-progress--use">
          USING {getItemDef(s.useItem.itemId).name.toUpperCase()}
          <i style={{ width: `${100 - (s.useItem.remainingMs / s.useItem.totalMs) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** [E] card: what the nearest pickup is (rarity, weapon stats / ammo) or which crate opens. */
function InteractCard({ hud }: { hud: HudState }) {
  const h = hud.interactHint;
  if (!h) return null;
  if (h.kind === 'crate') {
    return (
      <div className={`hud-interact ${h.locked ? 'is-locked' : ''}`}>
        <kbd>E</kbd>
        <span>{h.locked ? `${h.label} · locked until Combat Phase` : `Open ${h.label}`}</span>
      </div>
    );
  }
  const def = getItemDef(h.itemId);
  const cfg = RARITY_CONFIG[def.rarity];
  const weapon = def.metadata.weaponId && isWeaponId(def.metadata.weaponId) ? WEAPONS[def.metadata.weaponId] : null;
  const style = { '--rarity': cfg.color } as CSSProperties;
  return (
    <div key={h.id} className={`hud-interact hud-interact--item rarity-${def.rarity.toLowerCase()}`} style={style}>
      <kbd>E</kbd>
      <ItemIcon type={def.type} rarity={def.rarity} icon={def.icon} size={34} />
      <div className="hud-interact__text">
        <span className="hud-interact__rarity">{cfg.label}</span>
        <strong>
          {def.name}
          {h.qty > 1 ? ` ×${h.qty}` : ''}
        </strong>
        {weapon ? (
          <small>
            {weapon.displayName} · {MODE_LABEL(weapon)} · AMMO {h.mag ?? weapon.magazineSize}/{weapon.magazineSize}
            {hud.self ? ` · ${hud.self.ammo[weapon.ammoType]} ${weapon.ammoType}` : ''}
          </small>
        ) : def.estimatedValue > 0 ? (
          <small>
            <Usdc cents={def.estimatedValue * h.qty} />
          </small>
        ) : (
          <small>{def.metadata.description ?? ''}</small>
        )}
      </div>
    </div>
  );
}

/** Small, clean moment for LEGENDARY+ finds (not a casino popup). */
function LegendaryMoment({ hud }: { hud: HudState }) {
  const l = hud.legendary;
  if (!l) return null;
  const def = getItemDef(l.itemId);
  const cfg = RARITY_CONFIG[def.rarity];
  return (
    <div key={l.id} className="hud-legendary" style={{ '--rarity': cfg.color } as CSSProperties} role="status">
      <span>{cfg.label.toUpperCase()}</span>
      <strong>{def.name.toUpperCase()}</strong>
      <em>
        Estimated value <Usdc cents={l.value || def.estimatedValue} />
      </em>
    </div>
  );
}

function KillFeed({ hud }: { hud: HudState }) {
  return (
    <ul className="hud-feed">
      {hud.feed.map((f) => (
        <li key={f.id} className={f.mine ? 'is-mine' : ''}>
          {f.killer ? <b>{f.killer}</b> : <em>zone</em>}
          <span className="hud-feed__weapon">{f.weapon ?? '✕'}</span>
          <b>{f.victim}</b>
          {f.bountyCents > 0 && (
            <span className="hud-feed__bounty">
              +<Usdc cents={f.bountyCents} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * In-match HUD. Re-renders only when the client publishes new HUD state
 * (at most 10 Hz); timed effects are CSS animations keyed by event ids.
 */
export function Hud({ client, hud }: { client: GameClient; hud: HudState }) {
  const s = hud.self;
  const g = hud.global;
  const lowHp = !!s && s.hp > 0 && s.hp < 30;
  const alertOn = performance.now() - hud.extractAlertAt < 3500;
  const medkits = hud.inventory.slots.reduce((n, x) => n + (x?.itemId === 'medkit' ? x.qty : 0), 0);
  const plates = hud.inventory.slots.reduce((n, x) => n + (x?.itemId === 'armor_plate' ? x.qty : 0), 0);
  const lastKill = hud.feed.length > 0 ? [...hud.feed].reverse().find((f) => f.byMe) : undefined;

  return (
    <div className="hud" aria-live="polite">
      <div key={hud.hurtAt} className={`hud-vignette ${hud.hurtAt > 0 ? 'is-hit' : ''} ${lowHp ? 'is-low' : ''}`} />

      {hud.hurts.map((h) => (
        <div key={h.id} className={`hud-hurt-dir ${h.armor ? 'is-armor' : ''}`} style={{ transform: `translate(-50%, -50%) rotate(${h.angle}rad)` }}>
          <i />
        </div>
      ))}

      {lastKill && (
        <div key={lastKill.id} className="hud-killconfirm">
          <span>ELIMINATED</span>
          <strong>{lastKill.victim}</strong>
          {lastKill.bountyCents > 0 && (
            <em>
              +<Usdc cents={lastKill.bountyCents} /> BOUNTY
            </em>
          )}
        </div>
      )}

      <div className="hud-top-left">
        <Minimap client={client} />
      </div>

      <div className="hud-top-center">
        <Timer client={client} hud={hud} />
        <ExtractBeacon client={client} hud={hud} />
        <div className="hud-announcements">
          {hud.announcements.map((a) => (
            <div key={a.id} className={`hud-announce hud-announce--${a.kind}`}>
              <strong>{a.text}</strong>
              {a.sub && <span>{a.sub}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="hud-top-right">
        <div className="hud-stats">
          <div className="hud-stat">
            <span>ALIVE</span>
            <b>{g?.alive ?? '—'}</b>
          </div>
          <div className="hud-stat">
            <span>KILLS</span>
            <b>{s?.kills ?? 0}</b>
          </div>
        </div>
        <div className="hud-ping">{hud.ping} ms</div>
        <KillFeed hud={hud} />
      </div>

      <div className="hud-center-alerts">
        <KingpinBanner hud={hud} />
        <BountyBanner hud={hud} />
        {alertOn && <div className="hud-alert">SOMEONE IS EXTRACTING NEARBY</div>}
      </div>

      <ExtractionProgress hud={hud} />
      <ExtractionInterrupted hud={hud} />

      <InteractCard hud={hud} />
      <LegendaryMoment hud={hud} />

      <LootToasts hud={hud} />

      <div className="hud-notices">
        {hud.notices.map((n) => (
          <div key={n.id} className="hud-notice">
            {n.text}
          </div>
        ))}
      </div>

      {s && (
        <div className="hud-bottom">
          <div className="hud-vitals">
            <Bar value={s.hp} max={s.maxHp} className="hud-bar--hp" label="HEALTH" />
            <Bar value={s.armor} max={100} className="hud-bar--armor" label="ARMOR" />
            <div className="hud-consumables">
              <span><kbd>H</kbd> Medkit ×{medkits}</span>
              <span><kbd>G</kbd> Plate ×{plates}</span>
              <span><kbd>SPACE</kbd> Dash {s.dashCooldown > 0 ? `${s.dashCooldown.toFixed(1)}s` : 'ready'}</span>
            </div>
          </div>
          <WeaponPanel hud={hud} />
        </div>
      )}

      <BagValue hud={hud} />
    </div>
  );
}
