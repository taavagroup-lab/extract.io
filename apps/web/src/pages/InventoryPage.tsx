import { ECONOMY_CONFIG } from '@extract/game-config';
import type { InventoryItemDTO } from '@extract/game-types';
import { calculateMarketplaceFee, formatCents } from '@extract/shared';
import { Button, EmptyState, ItemIcon, Modal, Money, Panel, RarityBadge, Spinner } from '@extract/ui';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { navigate } from '../lib/router';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { PageShell } from './PageShell';

export function SellModal({ item, onClose, onDone }: { item: InventoryItemDTO; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(item.quantity);
  const [price, setPrice] = useState(((item.estimatedValue * item.quantity) / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cents = Math.round(Number(price) * 100);
  const valid = Number.isFinite(cents) && cents >= ECONOMY_CONFIG.marketplace.minPriceCents && qty >= 1 && qty <= item.quantity;
  const fee = valid ? calculateMarketplaceFee(cents) : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createListing(item.id, qty, cents);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Listing failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Sell ${item.name}`} onClose={onClose}>
      <div className="modal-body">
        {item.quantity > 1 && (
          <label className="field">
            <span>Quantity (max {item.quantity})</span>
            <input type="number" min={1} max={item.quantity} value={qty} onChange={(e) => setQty(Math.floor(Number(e.target.value)))} />
          </label>
        )}
        <label className="field">
          <span>Price (TEST USDC)</span>
          <input type="number" min={0.01} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <dl className="fee-table">
          <dt>Estimated value</dt>
          <dd>{formatCents(item.estimatedValue * qty)}</dd>
          <dt>Platform fee ({ECONOMY_CONFIG.marketplace.feeBps / 100}%)</dt>
          <dd>{fee ? `− ${formatCents(fee.feeCents)}` : '—'}</dd>
          <dt>You receive</dt>
          <dd className="is-strong">{fee ? formatCents(fee.sellerProceedsCents) : '—'}</dd>
        </dl>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>
            Create listing
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function InventoryPage() {
  const { user } = useStore(session);
  const [items, setItems] = useState<InventoryItemDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selling, setSelling] = useState<InventoryItemDTO | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .inventory()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load inventory'));
  }, []);
  useEffect(load, [load]);

  const mint = async (item: InventoryItemDTO) => {
    try {
      await api.mint(item.id);
      setNotice(`${item.name} minted on the mock chain`);
      load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Mint failed');
    }
  };

  const owned = items?.filter((i) => i.status === 'OWNED') ?? [];
  const total = owned.reduce((n, i) => n + i.estimatedValue * i.quantity, 0);

  return (
    <PageShell title="My Inventory">
      <Panel
        title={`Items · ${owned.length}`}
        actions={
          <span className="panel-meta">
            Stash value <Money cents={total} />
          </span>
        }
      >
        {notice && <p className="page-notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}
        {!items && !error && <Spinner label="Loading" />}
        {items && items.length === 0 && (
          <EmptyState title="Your stash is empty">
            <p>Extract from a match and everything you carry lands here.</p>
            <Button variant="primary" onClick={() => navigate('play')}>
              Play
            </Button>
          </EmptyState>
        )}
        {items && items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Rarity</th>
                  <th className="num">Quantity</th>
                  <th className="num">Est. value</th>
                  <th>Acquired</th>
                  <th>Season</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className={i.status === 'LISTED' ? 'is-muted' : ''}>
                    <td>
                      <div className="item-cell">
                        <ItemIcon type={i.type} rarity={i.rarity} size={32} />
                        <div>
                          <strong>{i.name}</strong>
                          {i.serialNumber !== null && (
                            <small className="serial">
                              #{i.serialNumber}
                              {i.maxSupply ? ` / ${i.maxSupply}` : ''}
                            </small>
                          )}
                          {i.blockchain && <small className="chain-tag">on-chain · {i.blockchain.chain}</small>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <RarityBadge rarity={i.rarity} />
                    </td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">
                      <Money cents={i.estimatedValue * i.quantity} />
                    </td>
                    <td>{new Date(i.acquiredAt).toLocaleDateString()}</td>
                    <td>{i.seasonName ?? '—'}</td>
                    <td className="row-actions">
                      {i.status === 'LISTED' ? (
                        <span className="tag">Listed</span>
                      ) : (
                        <>
                          {!i.blockchain && (
                            <Button size="sm" onClick={() => setSelling(i)}>
                              Sell
                            </Button>
                          )}
                          {user?.walletAddress && !i.blockchain && (i.quantity === 1) && (
                            <Button size="sm" variant="ghost" onClick={() => mint(i)}>
                              Mint
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {selling && (
        <SellModal
          item={selling}
          onClose={() => setSelling(null)}
          onDone={() => {
            setSelling(null);
            setNotice('Listing created. See it in the Marketplace.');
            load();
          }}
        />
      )}
    </PageShell>
  );
}
