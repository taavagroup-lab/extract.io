import { getItemDef } from '@extract/game-config';
import type { DeathSummary, ExtractionSummary, ItemAmount, MatchEndSummary } from '@extract/game-types';
import { formatCents, formatDuration } from '@extract/shared';
import { Button, ItemIcon } from '@extract/ui';

function ItemList({ items }: { items: ItemAmount[] }) {
  if (items.length === 0) return <p className="result-empty">No items</p>;
  return (
    <ul className="result-items">
      {items.map((i) => {
        const def = getItemDef(i.itemId);
        return (
          <li key={i.itemId}>
            <ItemIcon type={def.type} rarity={def.rarity} icon={def.icon} size={30} />
            <span>{def.name}</span>
            <small>×{i.qty}</small>
            <b>{formatCents(def.estimatedValue * i.qty)}</b>
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

function Buttons({ onPlayAgain, onInventory, onMenu }: Actions) {
  return (
    <div className="result-actions">
      <Button variant="primary" size="lg" onClick={onPlayAgain} autoFocus>
        Play again
      </Button>
      <Button onClick={onInventory}>Inventory</Button>
      <Button variant="ghost" onClick={onMenu}>
        Main menu
      </Button>
    </div>
  );
}

export function DeathScreen({ d, ...actions }: { d: DeathSummary } & Actions) {
  const title = d.reason === 'timeout' ? 'MISSING IN ACTION' : d.reason === 'abandoned' ? 'RUN ABANDONED' : 'ELIMINATED';
  return (
    <div className="result result--death">
      <div className="result-card">
        <h1>{title}</h1>
        {d.reason === 'killed' && (
          <p className="result-sub">
            Killed by <b>{d.killerName ?? 'the zone'}</b>
            {d.weaponName && <> with {d.weaponName}</>}
          </p>
        )}
        {d.reason === 'timeout' && <p className="result-sub">You did not extract before 10:00. Only your secure slot survived.</p>}
        <div className="result-stats">
          <div><span>Kills</span><b>{d.kills}</b></div>
          <div><span>Damage</span><b>{d.damageDealt}</b></div>
          <div><span>Survived</span><b>{formatDuration(d.survivedMs)}</b></div>
          <div className="is-good"><span>Loot Secured</span><b>{formatCents(d.lootSecuredCents)}</b></div>
          <div className="is-bad"><span>Loot Lost</span><b>{formatCents(d.lootLostCents)}</b></div>
        </div>
        {d.insuranceCents > 0 && (
          <p className="result-note">Includes {formatCents(d.insuranceCents)} auto-secure payout credited as TEST USDC.</p>
        )}
        {d.bountyLostCents > 0 && <p className="result-note">Uncollected bounty lost: {formatCents(d.bountyLostCents)}</p>}
        <h3>Kept</h3>
        <ItemList items={d.keptItems} />
        <Buttons {...actions} />
      </div>
    </div>
  );
}

export function ExtractedScreen({ x, ...actions }: { x: ExtractionSummary } & Actions) {
  return (
    <div className="result result--extracted">
      <div className="result-card">
        <h1>EXTRACTED</h1>
        <p className="result-sub">
          via <b>{x.extractionPoint}</b> · everything you carried is now in your inventory
        </p>
        <div className="result-stats">
          <div className="is-good"><span>Loot Extracted</span><b>{formatCents(x.valueCents)}</b></div>
          <div><span>Kills</span><b>{x.kills}</b></div>
          <div><span>Damage</span><b>{x.damageDealt}</b></div>
          <div><span>Survived</span><b>{formatDuration(x.survivedMs)}</b></div>
          {x.bountyEarnedCents > 0 && <div className="is-good"><span>Bounty</span><b>{formatCents(x.bountyEarnedCents)}</b></div>}
        </div>
        <h3>Secured items</h3>
        <ItemList items={x.items} />
        <Buttons {...actions} />
      </div>
    </div>
  );
}

export function MatchEndScreen({ r, ...actions }: { r: MatchEndSummary } & Actions) {
  return (
    <div className="result">
      <div className="result-card">
        <h1>MATCH OVER</h1>
        <p className="result-sub">{formatDuration(r.durationMs)} · {r.totalPlayers} players</p>
        <h3>Extracted</h3>
        {r.extracted.length === 0 ? <p className="result-empty">Nobody made it out.</p> : (
          <ul className="result-items">
            {r.extracted.map((e, i) => (
              <li key={i}><span>{e.name}</span><b>{formatCents(e.valueCents)}</b></li>
            ))}
          </ul>
        )}
        <Buttons {...actions} />
      </div>
    </div>
  );
}
