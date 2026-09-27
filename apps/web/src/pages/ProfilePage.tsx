import type { ProfileDTO, SeasonDTO, WalletDTO } from '@extract/game-types';
import { formatCents, formatDuration } from '@extract/shared';
import { Button, EmptyState, Panel, Spinner } from '@extract/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api';
import { navigate } from '../lib/router';
import { session } from '../lib/session';
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

export function ProfilePage() {
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

  return (
    <PageShell title="Profile">
      <div className="profile-grid">
        <Panel title={profile.user.username} actions={<span className="tag">{profile.user.isGuest ? 'Guest' : 'Registered'}</span>}>
          <div className="stat-grid">
            <div><span>Balance</span><b>{formatCents(profile.user.balanceCents)}</b></div>
            <div><span>Matches</span><b>{s.totalMatches}</b></div>
            <div><span>Extractions</span><b>{s.totalExtractions}</b></div>
            <div><span>Kills</span><b>{s.totalKills}</b></div>
            <div><span>Deaths</span><b>{s.totalDeaths}</b></div>
            <div><span>K/D</span><b>{kd}</b></div>
            <div><span>Loot extracted</span><b>{formatCents(s.totalLootExtractedCents)}</b></div>
            <div><span>Best extraction</span><b>{formatCents(s.highestSingleExtractionCents)}</b></div>
            <div><span>Best kill streak</span><b>{s.highestKillStreak}</b></div>
            <div><span>Bounty kills</span><b>{s.bountyKills}</b></div>
            <div><span>Bounty earned</span><b>{formatCents(s.bountyEarnedCents)}</b></div>
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
          {season && (
            <Panel title={`Season ${season.number}`}>
              <p className="season-name">{season.name}</p>
              <p className="muted">
                {new Date(season.startDate).toLocaleDateString()} – {new Date(season.endDate).toLocaleDateString()}
              </p>
              {crown && (
                <p className="season-item">
                  Genesis Crown minted <b>{crown.currentSupply}</b> / {crown.maxSupply}
                </p>
              )}
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Recent matches" className="mt">
        {profile.recentMatches.length === 0 ? (
          <EmptyState title="No matches yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Result</th>
                  <th className="num">Kills</th>
                  <th className="num">Loot</th>
                  <th className="num">Secured</th>
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
                    <td className="num">{formatCents(m.lootValueCents)}</td>
                    <td className="num">{formatCents(m.securedValueCents)}</td>
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
