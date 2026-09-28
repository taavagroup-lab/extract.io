import { ECONOMY_CONFIG, RARITY_CONFIG } from '@extract/game-config';
import { RARITIES, type InventoryItemDTO, type Rarity } from '@extract/game-types';
import { calculateMarketplaceFee } from '@extract/shared';
import { Button, EmptyState, Modal, Spinner, Stat, Tabs } from '@extract/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Usdc } from '../components/Brand';
import { ItemCard, MetaRow, formatSerial, limitedLabel } from '../components/ItemCard';
import { ApiError, api } from '../lib/api';
import { useCurrency } from '../lib/publicConfig';
import { navigate } from '../lib/router';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { PageShell } from './PageShell';

export function SellModal({ item, onClose, onDone }: { item: InventoryItemDTO; onClose: () => void; onDone: () => void }) {
  const { unit, format } = useCurrency();
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
          <span>Price ({unit})</span>
          <input type="number" min={0.01} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <dl className="fee-table">
          <dt>Estimated value</dt>
          <dd>{format(item.estimatedValue * qty)}</dd>
          <dt>Market fee ({ECONOMY_CONFIG.marketplace.feeBps / 100}%)</dt>
          <dd>{fee ? `− ${format(fee.feeCents)}` : '—'}</dd>
          <dt>You receive</dt>
          <dd className="is-strong">{fee ? format(fee.sellerProceedsCents) : '—'}</dd>
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

type Sort = 'value' | 'rarity' | 'newest';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'value', label: 'Value' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'newest', label: 'Newest' },
];

const rank = (r: Rarity) => RARITY_CONFIG[r].rank;
const stackValue = (i: InventoryItemDTO) => i.estimatedValue * i.quantity;

function InventoryItem({ item, canMint, onSell, onMint }: { item: InventoryItemDTO; canMint: boolean; onSell: () => void; onMint: () => void }) {
  const limited = item.maxSupply !== null;
  const listed = item.status === 'LISTED';
  return (
    <ItemCard
      name={item.name}
      type={item.type}
      rarity={item.rarity}
      icon={item.icon}
      quantity={item.quantity}
      muted={listed}
      kicker={limited ? limitedLabel(item.seasonName) : null}
      badges={
        <>
          {listed && <span className="x-chip">Listed</span>}
          {item.blockchain && <span className="x-chip x-chip--accent">On-chain</span>}
        </>
      }
      footer={
        listed ? (
          <Button size="sm" variant="ghost" onClick={() => navigate('marketplace')}>
            View listing
          </Button>
        ) : (
          <>
            {!item.blockchain && (
              <Button size="sm" onClick={onSell}>
                Sell
              </Button>
            )}
            {canMint && !item.blockchain && item.quantity === 1 && (
              <Button size="sm" variant="ghost" onClick={onMint}>
                Mint
              </Button>
            )}
          </>
        )
      }
    >
      <div className="item-card__value">
        <Usdc cents={stackValue(item)} />
        {item.quantity > 1 && (
          <small>
            <Usdc cents={item.estimatedValue} /> each
          </small>
        )}
      </div>
      {item.serialNumber !== null && <MetaRow label="Serial">{formatSerial(item.serialNumber, item.maxSupply)}</MetaRow>}
      {limited && item.discovered !== null && (
        <MetaRow label="Discovered">
          {item.discovered} / {item.maxSupply}
        </MetaRow>
      )}
      <MetaRow label="Season">{item.seasonName ?? '—'}</MetaRow>
      <MetaRow label="Acquired">{new Date(item.acquiredAt).toLocaleDateString()}</MetaRow>
    </ItemCard>
  );
}

export function InventoryPage() {
  const { user } = useStore(session);
  const [items, setItems] = useState<InventoryItemDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selling, setSelling] = useState<InventoryItemDTO | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('value');
  const [rarity, setRarity] = useState<Rarity | 'ALL'>('ALL');

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

  const summary = useMemo(() => {
    const all = items ?? [];
    const listed = all.filter((i) => i.status === 'LISTED');
    return {
      total: all.reduce((n, i) => n + stackValue(i), 0),
      listed: listed.reduce((n, i) => n + stackValue(i), 0),
      units: all.reduce((n, i) => n + i.quantity, 0),
      top: all.filter((i) => rank(i.rarity) >= rank('LEGENDARY')).reduce((n, i) => n + i.quantity, 0),
      limited: all.filter((i) => i.serialNumber !== null).length,
    };
  }, [items]);

  const visible = useMemo(() => {
    const list = (items ?? []).filter((i) => rarity === 'ALL' || i.rarity === rarity);
    const by: Record<Sort, (a: InventoryItemDTO, b: InventoryItemDTO) => number> = {
      value: (a, b) => stackValue(b) - stackValue(a),
      rarity: (a, b) => rank(b.rarity) - rank(a.rarity) || stackValue(b) - stackValue(a),
      newest: (a, b) => b.acquiredAt.localeCompare(a.acquiredAt),
    };
    return [...list].sort(by[sort]);
  }, [items, sort, rarity]);

  return (
    <PageShell title="Inventory" kicker="Everything you got out with">
      <section className="summary-strip">
        <Stat label="Total inventory value" value={<Usdc cents={summary.total} />} accent />
        <Stat label="Items" value={summary.units} />
        <Stat label="Legendary +" value={summary.top} />
        <Stat label="Limited serials" value={summary.limited} />
        <Stat label="Listed on market" value={<Usdc cents={summary.listed} />} />
      </section>

      {notice && <p className="page-notice">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      {!items && !error && <Spinner label="Loading" />}
      {items && items.length === 0 && (
        <EmptyState title="Your stash is empty">
          <p>Extract from a raid and everything you carry lands here.</p>
          <Button variant="primary" onClick={() => navigate('play')}>
            Play
          </Button>
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <>
          <div className="toolbar">
            <Tabs
              value={rarity}
              onChange={setRarity}
              options={[{ value: 'ALL' as const, label: 'All' }, ...RARITIES.map((r) => ({ value: r, label: RARITY_CONFIG[r].label }))]}
            />
            <label className="toolbar__sort">
              <span className="x-kicker">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {visible.length === 0 ? (
            <EmptyState title="Nothing of that rarity yet" />
          ) : (
            <div className="card-grid">
              {visible.map((i) => (
                <InventoryItem key={i.id} item={i} canMint={!!user?.walletAddress} onSell={() => setSelling(i)} onMint={() => void mint(i)} />
              ))}
            </div>
          )}
        </>
      )}
      {selling && (
        <SellModal
          item={selling}
          onClose={() => setSelling(null)}
          onDone={() => {
            setSelling(null);
            setNotice('Listing created. See it on the Market.');
            load();
          }}
        />
      )}
    </PageShell>
  );
}
