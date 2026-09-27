import { PHASE_LABELS, RARITY_CONFIG, WEAPONS, getItemDef, MATCH_CONFIG } from '@extract/game-config';
import { formatCents, formatClock } from '@extract/shared';
import { ItemIcon } from '@extract/ui';
import type { GameClient, HudState } from '../net/GameClient';
import { Minimap } from './MapViews';
import { useTicker } from './useHud';

function Timer({ client, hud }: { client: GameClient; hud: HudState }) {
  useTicker(250);
  const g = hud.global;
  if (!g) return null;
  const elapsed = client.serverNow();
  const remaining = Math.max(0, g.durationMs - elapsed);
  const final = elapsed >= MATCH_CONFIG.finalWarningAtMs;
  const extraction = g.phase === 'EXTRACTION_PHASE';
  return (
    <div className={`hud-timer ${final ? 'hud-timer--final' : ''}`}>
      <span className="hud-timer__label">MATCH TIME</span>
      <span className="hud-timer__value">{formatClock(remaining)}</span>
      <span className={`hud-timer__phase ${extraction ? 'is-extract' : ''}`}>
        {final ? 'WARNING · FINAL MINUTE' : extraction ? 'EXTRACTION AVAILABLE' : PHASE_LABELS[g.phase]}
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

function WeaponPanel({ hud }: { hud: HudState }) {
  const s = hud.self;
  if (!s) return null;
  const active = s.weapons[s.activeSlot];
  const def = active ? WEAPONS[active.weaponId] : null;
  const reserve = def ? s.ammo[def.ammoType] : 0;
  const mag = hud.mag ?? active?.mag ?? 0;
  const lowAmmo = def ? mag <= Math.ceil(def.magazineSize * 0.25) : false;
  return (
    <div className="hud-weapon">
      <div className="hud-weapon__main">
        {active && <ItemIcon type="WEAPON" rarity={getItemDef(active.itemId).rarity} icon={getItemDef(active.itemId).icon} size={34} />}
        <span className="hud-weapon__name">{def?.name ?? 'Unarmed'}</span>
        <span className="hud-weapon__ammo">
          <b className={mag === 0 ? 'is-empty' : lowAmmo ? 'is-low' : ''}>{mag}</b>
          <small> / {reserve}</small>
        </span>
      </div>
      {def && (
        <div className="hud-mag" aria-hidden="true">
          {Array.from({ length: Math.min(def.magazineSize, 30) }, (_, i) => (
            <i key={i} className={i < Math.round((mag / def.magazineSize) * Math.min(def.magazineSize, 30)) ? 'is-full' : ''} />
          ))}
        </div>
      )}
      <div className="hud-weapon__slots">
        {s.weapons.map((w, i) => (
          <span key={i} className={`hud-slot ${i === s.activeSlot ? 'is-active' : ''} ${w ? '' : 'is-empty'}`}>
            <kbd>{i + 1}</kbd>
            {w ? WEAPONS[w.weaponId].name : '—'}
          </span>
        ))}
      </div>
      {s.reloadRemainingMs > 0 && (
        <div className="hud-progress">
          RELOADING
          <i style={{ width: `${100 - (s.reloadRemainingMs / Math.max(1, s.reloadTotalMs)) * 100}%` }} />
        </div>
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

export function Hud({ client, hud }: { client: GameClient; hud: HudState }) {
  const now = useTicker(100);
  const s = hud.self;
  const g = hud.global;
  const hurt = now - hud.hurtAt < 350;
  const lowHp = !!s && s.hp > 0 && s.hp < 30;
  const alertOn = now - hud.extractAlertAt < 3500;
  const medkits = hud.inventory.slots.reduce((n, x) => n + (x?.itemId === 'medkit' ? x.qty : 0), 0);
  const plates = hud.inventory.slots.reduce((n, x) => n + (x?.itemId === 'armor_plate' ? x.qty : 0), 0);
  const lastKill = [...hud.feed].reverse().find((f) => f.byMe && now - f.at < 1800);

  return (
    <div className="hud" aria-live="polite">
      <div className={`hud-vignette ${hurt ? 'is-on' : ''} ${lowHp ? 'is-low' : ''}`} />

      {hud.hurts.map((h) => (
        <div
          key={h.id}
          className="hud-hurt-dir"
          style={{ transform: `translate(-50%, -50%) rotate(${h.angle}rad)`, opacity: Math.max(0, 1 - (now - h.at) / 1200) }}
        >
          <i />
        </div>
      ))}

      {lastKill && (
        <div key={lastKill.id} className="hud-killconfirm">
          <span>ELIMINATED</span>
          <strong>{lastKill.victim}</strong>
          {lastKill.bountyCents > 0 && <em>+{formatCents(lastKill.bountyCents)} BOUNTY</em>}
        </div>
      )}

      <div className="hud-top-left">
        <Minimap client={client} />
      </div>

      <div className="hud-top-center">
        <Timer client={client} hud={hud} />
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
        <div className="hud-stat">
          <span>ALIVE</span>
          <b>{g?.alive ?? '—'}</b>
        </div>
        <div className="hud-stat">
          <span>KILLS</span>
          <b>{s?.kills ?? 0}</b>
        </div>
        <div className="hud-ping">{hud.ping} ms</div>
        <ul className="hud-feed">
          {hud.feed.map((f) => (
            <li key={f.id} className={f.mine ? 'is-mine' : ''}>
              {f.killer ? <b>{f.killer}</b> : <em>zone</em>}
              <span className="hud-feed__weapon">{f.weapon ?? '✕'}</span>
              <b>{f.victim}</b>
              {f.bountyCents > 0 && <span className="hud-feed__bounty">+{formatCents(f.bountyCents)}</span>}
            </li>
          ))}
        </ul>
      </div>

      {s && s.bountyCents > 0 && (
        <div className="hud-hvt">
          <strong>HIGH VALUE TARGET</strong>
          <span>BOUNTY: {formatCents(s.bountyCents)}</span>
        </div>
      )}

      {alertOn && <div className="hud-alert">⚠ SOMEONE IS EXTRACTING NEARBY</div>}

      {s?.extraction && (
        <div className="hud-extract">
          <span>EXTRACTING</span>
          <b>{(s.extraction.remainingMs / 1000).toFixed(1)}s</b>
          <div className="hud-extract__bar">
            <i style={{ width: `${s.extraction.progress * 100}%` }} />
          </div>
          <small>Stay in the zone. Taking damage cancels.</small>
        </div>
      )}

      {hud.interactHint && (
        <div className="hud-interact">
          <kbd>E</kbd> {hud.interactHint}
        </div>
      )}

      <div className="hud-toasts">
        {hud.toasts.map((t) => {
          const def = getItemDef(t.itemId);
          const cfg = RARITY_CONFIG[def.rarity];
          return (
            <div key={t.id} className="hud-toast" style={{ borderColor: cfg.color, boxShadow: `0 0 28px ${cfg.color}44` }}>
              <ItemIcon type={def.type} rarity={def.rarity} icon={def.icon} size={42} />
              <div>
                <span style={{ color: cfg.color }}>{cfg.label.toUpperCase()} ITEM</span>
                <strong>{def.name.toUpperCase()}{t.qty > 1 ? ` ×${t.qty}` : ''}</strong>
                <small>Estimated Value {formatCents(t.value)}</small>
              </div>
            </div>
          );
        })}
      </div>

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

      {s && (
        <div className="hud-bag">
          <span>CURRENT BAG</span>
          <b>{formatCents(s.bagValue)}</b>
          {s.pendingBountyCents > 0 && <small>+ {formatCents(s.pendingBountyCents)} bounty on extract</small>}
          <em>TAB · INVENTORY</em>
        </div>
      )}
    </div>
  );
}
