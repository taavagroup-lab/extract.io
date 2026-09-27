import { WEAPONS, getItemDef } from '@extract/game-config';
import type { ItemStack } from '@extract/game-types';
import { formatCents, stackValue } from '@extract/shared';
import { Button, ItemIcon, RarityBadge } from '@extract/ui';
import { useState } from 'react';
import type { GameClient, HudState } from '../net/GameClient';

type Selection = { kind: 'bag'; slot: number } | { kind: 'secure' } | { kind: 'weapon'; slot: number } | null;

function Slot({ stack, selected, onClick, label }: { stack: ItemStack | null; selected: boolean; onClick: () => void; label?: string }) {
  const def = stack ? getItemDef(stack.itemId) : null;
  return (
    <button className={`inv-slot ${selected ? 'is-selected' : ''} ${stack ? '' : 'is-empty'}`} onClick={onClick} disabled={!stack}>
      {def && stack ? (
        <>
          <ItemIcon type={def.type} rarity={def.rarity} size={34} />
          {stack.qty > 1 && <span className="inv-slot__qty">{stack.qty}</span>}
        </>
      ) : (
        <span className="inv-slot__label">{label ?? ''}</span>
      )}
    </button>
  );
}

export function InventoryOverlay({ client, hud, onClose }: { client: GameClient; hud: HudState; onClose: () => void }) {
  const [sel, setSel] = useState<Selection>(null);
  const inv = hud.inventory;
  const s = hud.self;

  const selectedStack =
    sel?.kind === 'bag' ? inv.slots[sel.slot] ?? null : sel?.kind === 'secure' ? inv.secure : null;
  const selectedWeapon = sel?.kind === 'weapon' ? s?.weapons[sel.slot] ?? null : null;
  const def = selectedStack ? getItemDef(selectedStack.itemId) : selectedWeapon ? getItemDef(selectedWeapon.itemId) : null;

  const act = (fn: () => void) => {
    fn();
    setSel(null);
  };

  return (
    <div className="overlay overlay--inventory" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="inv-card">
        <header className="overlay__header">
          <h2>INVENTORY</h2>
          <span className="inv-value">
            BAG VALUE <b>{formatCents(s?.bagValue ?? 0)}</b>
          </span>
          <button className="overlay__close" onClick={onClose} aria-label="Close inventory">
            ×
          </button>
        </header>
        <div className="inv-body">
          <div className="inv-left">
            <h3>BACKPACK · {inv.slots.filter(Boolean).length}/{inv.slots.length}</h3>
            <div className="inv-grid">
              {inv.slots.map((stack, i) => (
                <Slot key={i} stack={stack} selected={sel?.kind === 'bag' && sel.slot === i} onClick={() => setSel({ kind: 'bag', slot: i })} />
              ))}
            </div>
            <h3>AMMO</h3>
            <div className="inv-ammo">
              <span>Light <b>{s?.ammo.light ?? 0}</b></span>
              <span>Rifle <b>{s?.ammo.rifle ?? 0}</b></span>
              <span>Shells <b>{s?.ammo.shell ?? 0}</b></span>
            </div>
          </div>
          <div className="inv-right">
            <h3>SECURE SLOT</h3>
            <p className="inv-help">Kept even if you die.</p>
            <div className="inv-secure">
              <Slot stack={inv.secure} selected={sel?.kind === 'secure'} onClick={() => setSel({ kind: 'secure' })} label="EMPTY" />
            </div>
            <h3>WEAPONS</h3>
            <div className="inv-weapons">
              {(s?.weapons ?? []).map((w, i) => (
                <button
                  key={i}
                  className={`inv-weapon ${sel?.kind === 'weapon' && sel.slot === i ? 'is-selected' : ''}`}
                  disabled={!w}
                  onClick={() => setSel({ kind: 'weapon', slot: i })}
                >
                  <kbd>{i + 1}</kbd>
                  <span>{w ? WEAPONS[w.weaponId].name : 'Empty'}</span>
                  {w && <small>{w.mag}/{WEAPONS[w.weaponId].magazineSize}</small>}
                </button>
              ))}
            </div>
            <div className="inv-detail">
              {def ? (
                <>
                  <div className="inv-detail__head">
                    <ItemIcon type={def.type} rarity={def.rarity} size={44} />
                    <div>
                      <strong>{def.name}</strong>
                      <RarityBadge rarity={def.rarity} />
                    </div>
                  </div>
                  <p>{def.metadata.description}</p>
                  <p className="inv-detail__value">
                    Est. value {formatCents(selectedStack ? stackValue(selectedStack) : def.metadata.starter ? 0 : def.estimatedValue)}
                  </p>
                  <div className="inv-actions">
                    {sel?.kind === 'bag' && def.type === 'CONSUMABLE' && (
                      <Button variant="primary" size="sm" onClick={() => act(() => client.inventoryOp({ op: 'use', slot: sel.slot }))}>
                        Use
                      </Button>
                    )}
                    {sel?.kind === 'bag' && (
                      <Button size="sm" onClick={() => act(() => client.inventoryOp({ op: 'secure', slot: sel.slot }))}>
                        Secure
                      </Button>
                    )}
                    {sel?.kind === 'bag' && (
                      <Button variant="danger" size="sm" onClick={() => act(() => client.inventoryOp({ op: 'drop', slot: sel.slot }))}>
                        Drop
                      </Button>
                    )}
                    {sel?.kind === 'secure' && (
                      <Button size="sm" onClick={() => act(() => client.inventoryOp({ op: 'unsecure' }))}>
                        Move to bag
                      </Button>
                    )}
                    {sel?.kind === 'weapon' && (
                      <>
                        <Button size="sm" onClick={() => act(() => client.action({ k: 'switch', slot: sel.slot }))}>
                          Equip
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => act(() => client.inventoryOp({ op: 'dropWeapon', slot: sel.slot }))}>
                          Drop
                        </Button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p className="inv-help">Select an item. Put your most valuable item in the secure slot.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
