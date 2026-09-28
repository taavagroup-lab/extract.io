import { BRAND } from '@extract/game-config';
import { Button } from '@extract/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Atmosphere } from '../components/Atmosphere';
import { SeasonBadge, TokenBadge, Usdc, Wordmark } from '../components/Brand';
import { LiveStats } from '../components/LiveStats';
import { ApiError, api } from '../lib/api';
import { navigate, type Route } from '../lib/router';
import { session } from '../lib/session';
import { useStore } from '../lib/store';

function EntryForm() {
  const [mode, setMode] = useState<'guest' | 'login'>('guest');
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem('extractio.lastName') ?? '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const auth = mode === 'guest' ? await api.guest(username.trim()) : await api.login(username.trim(), password);
      try {
        localStorage.setItem('extractio.lastName', username.trim());
      } catch {
        // ignore
      }
      session.signIn(auth);
      if (mode === 'guest') navigate('play');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Something went wrong';
      setError(err instanceof ApiError && err.code === 'username_taken' ? `${msg}. Pick another name or log in.` : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="entry-form" onSubmit={submit}>
      <label htmlFor="username" className="x-kicker">
        {mode === 'guest' ? 'Callsign' : 'Log in'}
      </label>
      <div className="entry-form__row">
        <input
          id="username"
          autoFocus
          autoComplete="username"
          maxLength={16}
          placeholder="enter a name"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        {mode === 'login' && (
          <input type="password" autoComplete="current-password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <Button type="submit" variant="primary" size="lg" disabled={busy || username.trim().length < 3}>
        {mode === 'guest' ? 'Play' : 'Log in'}
      </Button>
      <div className="entry-form__foot">
        {mode === 'guest' && <span className="form-hint">No wallet. No signup. Just a name.</span>}
        <button type="button" className="link-btn" onClick={() => setMode(mode === 'guest' ? 'login' : 'guest')}>
          {mode === 'guest' ? 'Have an account? Log in' : 'Play as guest instead'}
        </button>
      </div>
    </form>
  );
}

/** Live 3D flight over the map behind the menu (lazy-loaded, skipped for reduced motion). */
function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let backdrop: { dispose(): void } | null = null;
    let cancelled = false;
    void import('../game/render3d/MenuBackdrop').then(({ MenuBackdrop }) => {
      if (!cancelled && ref.current) backdrop = new MenuBackdrop(ref.current);
    });
    return () => {
      cancelled = true;
      backdrop?.dispose();
    };
  }, []);
  return <div ref={ref} className="menu-3d" aria-hidden="true" />;
}

const NAV: { route: Route; label: string; hint: string }[] = [
  { route: 'inventory', label: 'Inventory', hint: 'Your extracted loot' },
  { route: 'marketplace', label: 'Market', hint: 'Trade in USDC' },
  { route: 'leaderboard', label: 'Leaderboard', hint: 'Season standings' },
  { route: 'profile', label: 'Profile', hint: 'Stats & record' },
];

export function MainMenu() {
  const { user, token } = useStore(session);

  useEffect(() => {
    if (token) api.me().then((u) => session.setUser(u)).catch(() => {});
  }, [token]);

  return (
    <div className="menu">
      <Backdrop />
      <Atmosphere />
      <header className="menu-top">
        <LiveStats />
        {user && (
          <div className="user-chip">
            <span className="user-chip__name">{user.username}</span>
            <Usdc cents={user.balanceCents} className="user-chip__balance" />
            <button className="link-btn" onClick={() => session.clear()}>
              Log out
            </button>
          </div>
        )}
      </header>

      <main className="menu-main">
        <div className="menu-hero">
          <p className="x-kicker menu-hero__kicker">The extraction game on Solana</p>
          <Wordmark as="h1" className="menu-logo" />
          <p className="tagline">
            {BRAND.tagline.map((line, i) => (
              <span key={line} className={i === BRAND.tagline.length - 1 ? 'is-final' : ''}>
                {line}
              </span>
            ))}
          </p>
          {!user ? (
            <EntryForm />
          ) : (
            <div className="menu-actions">
              <Button variant="primary" size="lg" className="menu-play" onClick={() => navigate('play')}>
                Play
              </Button>
              <nav className="menu-nav" aria-label="Main">
                {NAV.map((n, i) => (
                  <button key={n.route} className="nav-tile" onClick={() => navigate(n.route)}>
                    <span className="nav-tile__idx">0{i + 1}</span>
                    <span className="nav-tile__label">{n.label}</span>
                    <span className="nav-tile__hint">{n.hint}</span>
                  </button>
                ))}
              </nav>
            </div>
          )}
        </div>
      </main>

      <footer className="menu-footer">
        <SeasonBadge />
        <p className="menu-slogan">{BRAND.slogan.join(' ')}</p>
        <TokenBadge />
      </footer>
    </div>
  );
}
