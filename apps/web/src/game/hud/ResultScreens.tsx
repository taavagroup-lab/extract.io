import { RARITY_CONFIG, getItemDef } from '@extract/game-config';
import type { DeathSummary, ExtractionSummary, ItemAmount, MatchEndSummary, Rarity } from '@extract/game-types';
import { formatDuration, summarizeItems } from '@extract/shared';
import { Button, ItemIcon } from '@extract/ui';
import { useEffect, useState, type CSSProperties } from 'react';
import { Usdc } from '../../components/Brand';
import { seasonShareFields } from '../share/shareCard';
import { ShareModal } from '../share/ShareModal';

/** Eased count-up for the headline number (skipped with reduced motion). */
function useCountUp(target: number, ms = 1100): number {
  const [v, setV] = useState(() => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? target : 0));
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(target);
    const start = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function ItemGrid({ items }: { items: ItemAmount[] }) {
  const sorted = [...items]
    .filter((i) => i.qty > 0)
    .sort((a, b) => {
      const da = getItemDef(a.itemId);
      const db = getItemDef(b.itemId);
      return RARITY_CONFIG[db.rarity].rank - RARITY_CONFIG[da.rarity].rank || db.estimatedValue * b.qty - da.estimatedValue * a.qty;
    });
  if (sorted.length === 0) return <p className="result-empty">No items</p>;
  return (
    <ul className="result-grid">
      {sorted.map((i, idx) => {
        const def = getItemDef(i.itemId);
        const style = { '--rarity': RARITY_CONFIG[def.rarity].color, animationDelay: `${300 + idx * 60}ms` } as CSSProperties;
        return (
          <li key={i.itemId} className={`result-item rarity-${def.rarity.toLowerCase()}`} style={style}>
            <ItemIcon type={def.type} rarity={def.rarity} icon={def.icon} size={40} />
            <div>
              <strong>{def.name}</strong>
              <span>
                {RARITY_CONFIG[def.rarity].label}
                {i.qty > 1 ? ` · ×${i.qty}` : ''}
              </span>
            </div>
            <b>
              <Usdc cents={def.estimatedValue * i.qty} />
            </b>
          </li>
        );
      })}
    </ul>
  );
}

interface Actions {
  onPlayAgain: () => void;
  onInventory: () => void;
  onMenu: () => void;
}

function RarityStat({ rarity, count }: { rarity: Rarity; count: number }) {
  return (
    <div className="result-stat" style={{ '--c': RARITY_CONFIG[rarity].color } as CSSProperties}>
      <b>{count}</b>
      <span>{RARITY_CONFIG[rarity].label}</span>
    </div>
  );
}

export function ExtractedScreen({ x, playerName, ...actions }: { x: ExtractionSummary; playerName: string } & Actions) {
  const [sharing, setSharing] = useState(false);
  const shown = useCountUp(x.valueCents);
  const summary = summarizeItems(x.items);
  const counts = summary.rarityCounts;
  const highlight = (['MYTHIC', 'LEGENDARY', 'EPIC', 'RARE'] as const).filter((r) => (counts[r] ?? 0) > 0);
  return (
    <div className="result result--extracted">
      <div className="result-burst" aria-hidden="true" />
      <div className="result-card">
        <p className="result-kicker">EXTRACTION SUCCESSFUL</p>
        <h1>BAG SECURED</h1>
        <p className="result-sub">
          via <b>{x.extractionPoint}</b> · {formatDuration(x.survivedMs)} in the raid
        </p>

        <div className="result-hero">
          <span className="x-kicker">BAG VALUE</span>
          <Usdc cents={shown} className="result-hero__value" />
        </div>

        <div className="result-stats">
          <div className="result-stat">
            <b>{x.kills}</b>
            <span>{x.kills === 1 ? 'Kill' : 'Kills'}</span>
          </div>
          {highlight.map((r) => (
            <RarityStat key={r} rarity={r} count={counts[r]!} />
          ))}
          <div className="result-stat result-stat--xp">
            <b>+{x.xp.toLocaleString('en-US')}</b>
            <span>XP</span>
          </div>
          {x.bountyEarnedCents > 0 && (
            <div className="result-stat result-stat--gold">
              <b>
                <Usdc cents={x.bountyEarnedCents} />
              </b>
              <span>Bounty</span>
            </div>
          )}
        </div>

        <h3>Extracted items</h3>
        <ItemGrid items={x.items} />
        <p className="result-note">Everything above is now in your inventory.</p>

        <div className="result-actions">
          <Button variant="primary" size="lg" onClick={actions.onPlayAgain} autoFocus>
            Play again
          </Button>
          <Button size="lg" onClick={actions.onInventory}>
            Inventory
          </Button>
          <Button size="lg" onClick={() => setSharing(true)}>
            Share result
          </Button>
        </div>
        <button className="link-btn result-menu" onClick={actions.onMenu}>
          Main menu
        </button>
      </div>
      {sharing && (
        <ShareModal
          result={{ playerName, kills: x.kills, bagValueCents: x.valueCents, rarityCounts: counts, ...seasonShareFields() }}
          items={x.items}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}

export function DeathScreen({ d, ...actions }: { d: DeathSummary } & Actions) {
  const title = d.reason === 'timeout' ? 'MISSING IN ACTION' : d.reason === 'abandoned' ? 'RUN ABANDONED' : 'ELIMINATED';
  return (
    <div className="result result--death">
      <div className="result-card">
        <p className="result-kicker">RAID FAILED</p>
        <h1>{title}</h1>
        {d.reason === 'killed' && (
          <p className="result-sub">
            Killed by <b>{d.killerName ?? 'the zone'}</b>
            {d.weaponName && <> with {d.weaponName}</>}
          </p>
        )}
        {d.reason === 'timeout' && <p className="result-sub">You did not extract before the timer ran out. Only your secure slot survived.</p>}
        <div className="result-stats">
          <div className="result-stat result-stat--good">
            <b>
              <Usdc cents={d.lootSecuredCents} />
            </b>
            <span>Secured</span>
          </div>
          <div className="result-stat result-stat--bad">
            <b>
              <Usdc cents={d.lootLostCents} />
            </b>
            <span>Lost</span>
          </div>
          <div className="result-stat">
            <b>{d.kills}</b>
            <span>{d.kills === 1 ? 'Kill' : 'Kills'}</span>
          </div>
          <div className="result-stat">
            <b>{formatDuration(d.survivedMs)}</b>
            <span>Survived</span>
          </div>
          <div className="result-stat result-stat--xp">
            <b>+{d.xp.toLocaleString('en-US')}</b>
            <span>XP</span>
          </div>
        </div>
        {d.insuranceCents > 0 && (
          <p className="result-note">
            Includes <Usdc cents={d.insuranceCents} /> auto-secure payout credited to your balance.
          </p>
        )}
        {d.bountyLostCents > 0 && (
          <p className="result-note">
            Uncollected bounty lost: <Usdc cents={d.bountyLostCents} />
          </p>
        )}
        <h3>Kept</h3>
        <ItemGrid items={d.keptItems} />
        <div className="result-actions">
          <Button variant="primary" size="lg" onClick={actions.onPlayAgain} autoFocus>
            Play again
          </Button>
          <Button size="lg" onClick={actions.onInventory}>
            Inventory
          </Button>
        </div>
        <button className="link-btn result-menu" onClick={actions.onMenu}>
          Main menu
        </button>
      </div>
    </div>
  );
}

export function MatchEndScreen({ r, ...actions }: { r: MatchEndSummary } & Actions) {
  return (
    <div className="result">
      <div className="result-card">
        <p className="result-kicker">RAID CLOSED</p>
        <h1>MATCH OVER</h1>
        <p className="result-sub">
          {formatDuration(r.durationMs)} · {r.totalPlayers} players
        </p>
        <h3>Made it out</h3>
        {r.extracted.length === 0 ? (
          <p className="result-empty">Nobody made it out.</p>
        ) : (
          <ul className="result-list">
            {r.extracted.map((e, i) => (
              <li key={i}>
                <span>{e.name}</span>
                <b>
                  <Usdc cents={e.valueCents} />
                </b>
              </li>
            ))}
          </ul>
        )}
        <div className="result-actions">
          <Button variant="primary" size="lg" onClick={actions.onPlayAgain} autoFocus>
            Play again
          </Button>
          <Button size="lg" onClick={actions.onInventory}>
            Inventory
          </Button>
        </div>
        <button className="link-btn result-menu" onClick={actions.onMenu}>
          Main menu
        </button>
      </div>
    </div>
  );
}
