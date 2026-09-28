import { BRAND_NAME } from '@extract/game-config';
import type { ProfileDTO, SeasonDTO, WalletDTO } from '@extract/game-types';
import { formatDuration } from '@extract/shared';
import { Button, EmptyState, Panel, Spinner, Stat } from '@extract/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { SeasonBadge, TokenBadge, Usdc } from '../components/Brand';
import { ApiError, api } from '../lib/api';
import { publicConfig } from '../lib/publicConfig';
import { navigate } from '../lib/router';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { PageShell } from './PageShell';

function RegisterForm({ username, onDone }: { username: string; onDone: () => void }) {
  const [name, setName] = useState(username);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      session.signIn(await api.register(name.trim(), password));
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    }
  };
  return (
    <form className="register-form" onSubmit={submit}>
      <p>You are playing as a guest. Set a password to keep this account on any device. Inventory and stats are kept.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="username" autoComplete="username" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password (min. 8)" autoComplete="new-password" />
      {error && <p className="form-error">{error}</p>}
      <Button type="submit" variant="primary" disabled={password.length < 8}>
        Create account
      </Button>
    </form>
  );
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

function playtime(ms: number): string {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ProfilePage() {
  const { token: tokenCfg } = useStore(publicConfig);
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [season, setSeason] = useState<SeasonDTO | null>(null);
  const [wallet, setWallet] = useState<WalletDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .profile()
      .then((p) => {
        setProfile(p);
        session.setUser(p.user);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load profile'));
    api.wallet().then((w) => setWallet(w.wallet)).catch(() => {});
    api.season().then(setSeason).catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (error) return <PageShell title="Profile"><p className="form-error">{error}</p></PageShell>;
  if (!profile) return <PageShell title="Profile"><Spinner label="Loading" /></PageShell>;
  const s = profile.stats;
  const kd = s.totalDeaths > 0 ? (s.totalKills / s.totalDeaths).toFixed(2) : s.totalKills.toFixed(2);
  const crown = season?.specialItems.find((i) => i.itemId === 'genesis_crown');
  const standing = profile.season;

  return (
    <PageShell title={profile.user.username} kicker={profile.user.isGuest ? 'Guest operator' : 'Registered operator'}>
      <section className="profile-hero">
        <div className="profile-hero__season">
          <SeasonBadge />
          {standing && (
            <div className="profile-hero__rank">
              <span className="x-kicker">Season rank</span>
              <b>{standing.rank !== null ? `#${standing.rank}` : 'Unranked'}</b>
              <small>
                {standing.xp.toLocaleString('en-US')} XP
                {standing.rank !== null && ` · of ${standing.rankedPlayers.toLocaleString('en-US')}`}
              </small>
            </div>
          )}
        </div>
        <div className="profile-hero__balance">
          <span className="x-kicker">Balance</span>
          <Usdc cents={profile.user.balanceCents} className="profile-hero__money" />
        </div>
      </section>

      <div className="profile-grid">
        <Panel title="Extraction record">
          <div className="stat-grid">
            <Stat label="Extractions" value={s.totalExtractions} accent />
            <Stat label="Failed extractions" value={s.failedExtractions} />
            <Stat label="Extraction rate" value={pct(s.totalExtractions, s.totalMatches)} hint={`${s.totalMatches} raids`} />
            <Stat label="Total loot extracted" value={<Usdc cents={s.totalLootExtractedCents} />} />
            <Stat label="Biggest bag" value={<Usdc cents={s.highestSingleExtractionCents} />} />
            <Stat label="Legendary extracted" value={s.legendaryExtracted} />
            <Stat label="Kingpin extractions" value={s.kingpinExtractions} />
            <Stat label="Kills" value={s.totalKills} />
            <Stat label="Deaths" value={s.totalDeaths} />
            <Stat label="K/D" value={kd} />
            <Stat label="Best kill streak" value={s.highestKillStreak} />
            <Stat label="Bounty kills" value={s.bountyKills} hint={s.bountyEarnedCents > 0 ? <Usdc cents={s.bountyEarnedCents} /> : undefined} />
            <Stat label="Lifetime XP" value={s.totalXp.toLocaleString('en-US')} />
            <Stat label="Time in raids" value={playtime(s.playtimeMs)} />
          </div>
          <div className="profile-actions">
            <Button variant="ghost" onClick={() => { session.clear(); navigate('menu'); }}>
              Log out
            </Button>
          </div>
        </Panel>

        <div className="profile-side">
          {profile.user.isGuest && (
            <Panel title="Secure your account">
              <RegisterForm username={profile.user.username} onDone={load} />
            </Panel>
          )}
          {season && crown && crown.maxSupply !== null && (
            <Panel title="Genesis Crown">
              <div className="supply">
                <div className="supply__nums">
                  <b>{crown.currentSupply.toLocaleString('en-US')}</b>
                  <span>/ {crown.maxSupply.toLocaleString('en-US')} discovered</span>
                </div>
                <div className="supply__bar">
                  <i style={{ width: `${(crown.currentSupply / crown.maxSupply) * 100}%` }} />
                </div>
                <p className="muted">Limited to {crown.maxSupply.toLocaleString('en-US')} serials this season. Extract one to own a numbered piece.</p>
              </div>
            </Panel>
          )}
          {tokenCfg.enabled && (
            <Panel title="Community" className="token-panel">
              <TokenBadge />
              <p className="muted">
                {tokenCfg.symbol} is the community identity of {BRAND_NAME} on {tokenCfg.chain}. Nothing is tradable in the game today; the
                economy runs on test values.
              </p>
            </Panel>
          )}
          <Panel title="Wallet (optional)">
            {wallet ? (
              <div className="wallet-box">
                <p className="mono">{wallet.address}</p>
                <p className="muted">
                  {wallet.provider} · {wallet.chain}
                </p>
                <Button size="sm" variant="danger" onClick={async () => { await api.disconnectWallet(); setWallet(null); }}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="wallet-box">
                <p className="muted">Not needed to play or trade. Connect only for on-chain features. Development uses a mock chain.</p>
                <Button size="sm" onClick={async () => setWallet(await api.connectWallet())}>
                  Connect wallet
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Recent raids" className="mt">
        {profile.recentMatches.length === 0 ? (
          <EmptyState title="No raids yet">
            <Button variant="primary" onClick={() => navigate('play')}>
              Play
            </Button>
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Result</th>
                  <th className="num">Kills</th>
                  <th className="num">Bag</th>
                  <th className="num">Secured</th>
                  <th className="num">XP</th>
                  <th className="num">Survived</th>
                </tr>
              </thead>
              <tbody>
                {profile.recentMatches.map((m) => (
                  <tr key={m.matchId}>
                    <td>{new Date(m.createdAt).toLocaleString()}</td>
                    <td>
                      <span className={`tag tag--${m.outcome.toLowerCase()}`}>{m.outcome}</span>
                    </td>
                    <td className="num">{m.kills}</td>
                    <td className="num"><Usdc cents={m.lootValueCents} /></td>
                    <td className="num"><Usdc cents={m.securedValueCents} /></td>
                    <td className="num">{m.xp > 0 ? `+${m.xp}` : '—'}</td>
                    <td className="num">{formatDuration(m.survivedMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
