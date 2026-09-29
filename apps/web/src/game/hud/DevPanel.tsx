import { ITEM_DEFINITIONS, MATCH_CONFIG, WEAPONS } from '@extract/game-config';
import { WEAPON_IDS } from '@extract/game-types';
import { Button } from '@extract/ui';
import { useState } from 'react';
import { weaponDebugFlags, type WeaponDebugFlags } from '../../lib/devFlags';
import { useStore } from '../../lib/store';
import type { GameClient } from '../net/GameClient';

const DEBUG_LABELS: Record<keyof WeaponDebugFlags, string> = {
  hitboxes: 'Hitboxes',
  paths: 'Projectile paths',
  spread: 'Spread cone',
  muzzle: 'Muzzle point',
  stats: 'Weapon stats',
};

/** DEV ONLY. The server ignores these commands unless DEV_TOOLS is enabled (never in production). */
export function DevPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const [itemId, setItemId] = useState('assault_rifle');
  const [qty, setQty] = useState(1);
  const [bots, setBots] = useState(5);
  const [dmg, setDmg] = useState(25);
  const [tx, setTx] = useState(2000);
  const [ty, setTy] = useState(2000);
  const [infinite, setInfinite] = useState(false);
  const flags = useStore(weaponDebugFlags);

  const jump = (ms: number) => client.dev({ cmd: 'setMatchTime', ms });

  return (
    <div className="dev-panel">
      <header>
        <strong>DEV PANEL</strong>
        <button className="overlay__close" onClick={onClose} aria-label="Close dev panel">
          ×
        </button>
      </header>
      <section>
        <label>Spawn item</label>
        <div className="dev-row">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {ITEM_DEFINITIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.rarity.toLowerCase()})
              </option>
            ))}
          </select>
          <input type="number" min={1} max={999} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} />
          <Button size="sm" onClick={() => client.dev({ cmd: 'spawnItem', itemId, qty })}>
            Spawn
          </Button>
        </div>
      </section>
      <section>
        <label>Weapons</label>
        <div className="dev-row dev-row--wrap dev-weapons">
          {WEAPON_IDS.map((id) => (
            <Button key={id} size="sm" variant="ghost" onClick={() => client.dev({ cmd: 'giveWeapon', weaponId: id })}>
              {WEAPONS[id].name}
            </Button>
          ))}
        </div>
        <div className="dev-row dev-row--wrap dev-toggles">
          <label className="dev-check">
            <input
              type="checkbox"
              checked={infinite}
              onChange={(e) => {
                setInfinite(e.target.checked);
                client.dev({ cmd: 'infiniteAmmo', on: e.target.checked });
              }}
            />
            Infinite ammo
          </label>
          {(Object.keys(DEBUG_LABELS) as (keyof WeaponDebugFlags)[]).map((k) => (
            <label key={k} className="dev-check">
              <input type="checkbox" checked={flags[k]} onChange={(e) => weaponDebugFlags.set({ ...flags, [k]: e.target.checked })} />
              {DEBUG_LABELS[k]}
            </label>
          ))}
        </div>
      </section>
      <section>
        <label>Bots</label>
        <div className="dev-row">
          <input type="number" min={1} max={100} value={bots} onChange={(e) => setBots(Number(e.target.value) || 1)} />
          <Button size="sm" onClick={() => client.dev({ cmd: 'spawnBots', count: bots })}>
            Spawn bots
          </Button>
        </div>
      </section>
      <section>
        <label>Damage</label>
        <div className="dev-row">
          <input type="number" min={1} max={1000} value={dmg} onChange={(e) => setDmg(Number(e.target.value) || 1)} />
          <Button size="sm" onClick={() => client.dev({ cmd: 'damage', amount: dmg, target: 'self' })}>
            Self
          </Button>
          <Button size="sm" onClick={() => client.dev({ cmd: 'damage', amount: dmg, target: 'nearest' })}>
            Nearest player
          </Button>
        </div>
      </section>
      <section>
        <label>Teleport</label>
        <div className="dev-row">
          <input type="number" value={tx} onChange={(e) => setTx(Number(e.target.value))} />
          <input type="number" value={ty} onChange={(e) => setTy(Number(e.target.value))} />
          <Button size="sm" onClick={() => client.dev({ cmd: 'teleport', x: tx, y: ty })}>
            Go
          </Button>
        </div>
        <div className="dev-row">
          {(client.global?.extractionZones ?? [])
            .filter((z) => z.active)
            .map((z) => (
              <Button key={z.id} size="sm" onClick={() => client.dev({ cmd: 'teleport', x: z.position.x, y: z.position.y })}>
                → {z.name}
              </Button>
            ))}
        </div>
      </section>
      <section>
        <label>Match</label>
        <div className="dev-row dev-row--wrap">
          <Button size="sm" onClick={() => client.dev({ cmd: 'activateExtraction' })}>
            Activate extraction
          </Button>
          <Button size="sm" onClick={() => client.dev({ cmd: 'giveLegendary' })}>
            Give legendary
          </Button>
          <Button size="sm" onClick={() => client.dev({ cmd: 'heal' })}>
            Heal
          </Button>
        </div>
        <div className="dev-row dev-row--wrap">
          <Button size="sm" onClick={() => jump(MATCH_CONFIG.phases[1].startMs - 3000)}>
            → 01:57
          </Button>
          <Button size="sm" onClick={() => jump(MATCH_CONFIG.supplyDrops.firstAtMs - 3000)}>
            → 03:57
          </Button>
          <Button size="sm" onClick={() => jump(MATCH_CONFIG.phases[2].startMs - 3000)}>
            → 06:57
          </Button>
          <Button size="sm" onClick={() => jump(MATCH_CONFIG.finalWarningAtMs - 3000)}>
            → 08:57
          </Button>
          <Button variant="danger" size="sm" onClick={() => client.dev({ cmd: 'endMatch' })}>
            End match
          </Button>
        </div>
      </section>
      <p className="dev-foot">Toggle with ` or F2 · server-side validated</p>
    </div>
  );
}
