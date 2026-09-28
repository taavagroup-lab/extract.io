import { ECONOMY_CONFIG, RARITY_CONFIG, getItemDef } from '@extract/game-config';
import { RARITIES, type ListingDTO, type ListingSort, type Paginated, type Rarity, type TransactionDTO, type WalletDTO } from '@extract/game-types';
import { Button, EmptyState, ItemIcon, Modal, Panel, RarityBadge, Spinner, Tabs } from '@extract/ui';
import { useCallback, useEffect, useState } from 'react';
import { Usdc } from '../components/Brand';
import { ItemCard, MetaRow, formatSerial, limitedLabel } from '../components/ItemCard';
import { ApiError, api } from '../lib/api';
import { useCurrency } from '../lib/publicConfig';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { PageShell } from './PageShell';

type Tab = 'browse' | 'mine' | 'history';

const SORTS: { value: ListingSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low' },
  { value: 'price_desc', label: 'Price: High' },
  { value: 'rarity', label: 'Rarity' },
];

function refreshUser(): void {
  api.me().then((u) => session.setUser(u)).catch(() => {});
}

function WalletButton() {
  const [wallet, setWallet] = useState<WalletDTO | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.wallet().then((r) => setWallet(r.wallet)).catch(() => {});
  }, []);
  if (wallet) {
    return (
      <span className="wallet-chip" title={wallet.address}>
        ● {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)} <small>{wallet.provider}</small>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      title="Optional. Only needed for on-chain features (mock provider in development)."
      onClick={async () => {
        setBusy(true);
        try {
          setWallet(await api.connectWallet());
          refreshUser();
        } finally {
          setBusy(false);
        }
      }}
    >
      Connect wallet
    </Button>
  );
}

function BuyModal({ listing, onClose, onDone }: { listing: ListingDTO; onClose: () => void; onDone: (msg: string) => void }) {
  const { user } = useStore(session);
  const { format } = useCurrency();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per purchase attempt: retries (double click, network retry) cannot buy twice.
  const [key] = useState(() => crypto.randomUUID());
  const balance = user?.balanceCents ?? 0;
  const enough = balance >= listing.priceCents;

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      const tx = await api.buy(listing.id, key);
      refreshUser();
      onDone(`Bought ${listing.name} for ${format(tx.priceCents)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Purchase failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Confirm purchase" onClose={onClose}>
      <div className="modal-body">
        <div className="item-cell">
          <ItemIcon type={getItemDef(listing.itemId).type} rarity={listing.rarity} icon={listing.icon} size={40} />
          <div>
            <strong>
              {listing.name}
              {listing.quantity > 1 ? ` ×${listing.quantity}` : ''}
            </strong>
            <RarityBadge rarity={listing.rarity} />
          </div>
        </div>
        <dl className="fee-table">
          <dt>Price</dt>
          <dd className="is-strong">{format(listing.priceCents)}</dd>
          <dt>Your balance</dt>
          <dd>{format(balance)}</dd>
          <dt>After purchase</dt>
          <dd>{format(balance - listing.priceCents)}</dd>
        </dl>
        {!enough && <p className="form-error">Not enough balance.</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!enough || busy} onClick={buy}>
            Buy now
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ListingCard({ listing: l, own, onBuy }: { listing: ListingDTO; own: boolean; onBuy: () => void }) {
  const def = getItemDef(l.itemId);
  const perUnit = Math.round(l.priceCents / l.quantity);
  return (
    <ItemCard
      name={l.name}
      type={def.type}
      rarity={l.rarity}
      icon={l.icon}
      quantity={l.quantity}
      kicker={l.maxSupply !== null ? limitedLabel(l.seasonName) : null}
      badges={own ? <span className="x-chip">Yours</span> : null}
      footer={
        <>
          <div className="item-card__price">
            <Usdc cents={l.priceCents} />
            {l.quantity > 1 && (
              <small>
                <Usdc cents={perUnit} /> each
              </small>
            )}
          </div>
          <Button size="sm" variant={own ? 'ghost' : 'primary'} disabled={own} onClick={onBuy}>
            {own ? 'Listed' : 'Buy'}
          </Button>
        </>
      }
    >
      {l.serialNumber !== null && <MetaRow label="Serial">{formatSerial(l.serialNumber, l.maxSupply)}</MetaRow>}
      <MetaRow label="Floor">{l.floorCents !== null ? <Usdc cents={l.floorCents} /> : '—'}</MetaRow>
      <MetaRow label="Last sale">{l.lastSaleCents !== null ? <Usdc cents={l.lastSaleCents} /> : '—'}</MetaRow>
      <MetaRow label="Est. value">
        <Usdc cents={l.estimatedValue} />
      </MetaRow>
      {l.remainingSupply !== null && (
        <MetaRow label="Supply left">
          {l.remainingSupply} / {l.maxSupply}
        </MetaRow>
      )}
      <MetaRow label="Season">{l.seasonName ?? '—'}</MetaRow>
      <MetaRow label="Seller">{l.sellerName}</MetaRow>
    </ItemCard>
  );
}

function Browse({ onNotice }: { onNotice: (m: string) => void }) {
  const { user } = useStore(session);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [rarity, setRarity] = useState<Rarity | ''>('');
  const [sort, setSort] = useState<ListingSort>('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ListingDTO> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<ListingDTO | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setError(null);
    api
      .listings({ search: query || undefined, rarity: rarity || undefined, sort, page, pageSize: 24 })
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load listings'));
  }, [query, rarity, sort, page]);
  useEffect(load, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={rarity} onChange={(e) => { setRarity(e.target.value as Rarity | ''); setPage(1); }}>
          <option value="">All rarities</option>
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {RARITY_CONFIG[r].label}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => { setSort(e.target.value as ListingSort); setPage(1); }}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!data && !error && <Spinner label="Loading" />}
      {data && data.items.length === 0 && <EmptyState title="No listings found" />}
      {data && data.items.length > 0 && (
        <div className="card-grid">
          {data.items.map((l) => (
            <ListingCard key={l.id} listing={l} own={l.sellerId === user?.id} onBuy={() => setBuying(l)} />
          ))}
        </div>
      )}
      {data && pages > 1 && (
        <div className="pager">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Prev
          </Button>
          <span>
            {page} / {pages}
          </span>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      {buying && (
        <BuyModal
          listing={buying}
          onClose={() => setBuying(null)}
          onDone={(msg) => {
            setBuying(null);
            onNotice(msg);
            load();
          }}
        />
      )}
    </>
  );
}

function MyListings({ onNotice }: { onNotice: (m: string) => void }) {
  const [rows, setRows] = useState<ListingDTO[] | null>(null);
  const load = useCallback(() => {
    api.myListings().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  if (!rows) return <Spinner label="Loading" />;
  if (rows.length === 0) return <EmptyState title="No active listings">Sell items from your inventory.</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Rarity</th>
            <th className="num">Qty</th>
            <th className="num">Price</th>
            <th className="num">You receive</th>
            <th>Listed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>
                <div className="item-cell">
                  <ItemIcon type={getItemDef(l.itemId).type} rarity={l.rarity} icon={l.icon} size={28} />
                  <span>
                    {l.name}
                    {l.serialNumber !== null && <small className="serial"> {formatSerial(l.serialNumber, l.maxSupply)}</small>}
                  </span>
                </div>
              </td>
              <td>
                <RarityBadge rarity={l.rarity} />
              </td>
              <td className="num">{l.quantity}</td>
              <td className="num">
                <Usdc cents={l.priceCents} />
              </td>
              <td className="num">
                <Usdc cents={l.priceCents - Math.floor((l.priceCents * ECONOMY_CONFIG.marketplace.feeBps) / 10_000)} />
              </td>
              <td>{new Date(l.createdAt).toLocaleString()}</td>
              <td className="row-actions">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    try {
                      await api.cancelListing(l.id);
                      onNotice(`Listing cancelled · ${l.name} returned to your inventory`);
                    } catch (err) {
                      onNotice(err instanceof ApiError ? err.message : 'Cancel failed');
                    }
                    load();
                  }}
                >
                  Cancel
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History() {
  const [rows, setRows] = useState<TransactionDTO[] | null>(null);
  useEffect(() => {
    api.history().then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows) return <Spinner label="Loading" />;
  if (rows.length === 0) return <EmptyState title="No transactions yet" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Item</th>
            <th>Side</th>
            <th>Counterparty</th>
            <th className="num">Price</th>
            <th className="num">Fee</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{new Date(t.createdAt).toLocaleString()}</td>
              <td>
                {t.itemName}
                {t.quantity > 1 ? ` ×${t.quantity}` : ''}
              </td>
              <td>
                <span className={`tag ${t.role === 'buyer' ? 'tag--buy' : 'tag--sell'}`}>{t.role === 'buyer' ? 'Bought' : 'Sold'}</span>
              </td>
              <td>{t.counterparty}</td>
              <td className="num">
                <Usdc cents={t.priceCents} />
              </td>
              <td className="num">{t.role === 'seller' ? <Usdc cents={t.feeCents} /> : '—'}</td>
              <td className="num">
                <Usdc cents={t.role === 'buyer' ? -t.priceCents : t.sellerProceedsCents} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarketplacePage() {
  const { unit } = useCurrency();
  const [tab, setTab] = useState<Tab>('browse');
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  return (
    <PageShell title="Market" kicker={`Player trading · priced in ${unit}`} actions={<WalletButton />}>
      <Panel
        title={
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'browse', label: 'Browse' },
              { value: 'mine', label: 'My listings' },
              { value: 'history', label: 'History' },
            ]}
          />
        }
        actions={<span className="panel-meta">Fee {ECONOMY_CONFIG.marketplace.feeBps / 100}% · {unit}</span>}
      >
        {notice && <p className="page-notice">{notice}</p>}
        {tab === 'browse' && <Browse onNotice={setNotice} />}
        {tab === 'mine' && <MyListings onNotice={setNotice} />}
        {tab === 'history' && <History />}
      </Panel>
    </PageShell>
  );
}
