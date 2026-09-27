import { CURRENT_SEASON } from '@extract/game-config';
import { Button, Money } from '@extract/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api';
import { navigate } from '../lib/router';
import { session } from '../lib/session';
import { useStore } from '../lib/store';

function EntryForm() {
  const [mode, setMode] = useState<'guest' | 'login'>('guest');
  const [username, setUsername] = useState(() => localStorage.getItem('extractio.lastName') ?? '');
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
      <label htmlFor="username">{mode === 'guest' ? 'ENTER USERNAME' : 'LOG IN'}</label>
      <input
        id="username"
        autoFocus
        autoComplete="username"
        maxLength={16}
        placeholder="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      {mode === 'login' && (
        <input type="password" autoComplete="current-password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      )}
      {error && <p className="form-error">{error}</p>}
      <Button type="submit" variant="primary" size="lg" disabled={busy || username.trim().length < 3}>
        {mode === 'guest' ? 'Play' : 'Log in'}
      </Button>
      <button type="button" className="link-btn" onClick={() => setMode(mode === 'guest' ? 'login' : 'guest')}>
        {mode === 'guest' ? 'Have an account? Log in' : 'Play as guest instead'}
      </button>
      {mode === 'guest' && <p className="form-hint">No wallet. No signup. Just a name.</p>}
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

export function MainMenu() {
  const { user, token } = useStore(session);

  useEffect(() => {
    if (token) api.me().then((u) => session.setUser(u)).catch(() => {});
  }, [token]);

  return (
    <div className="menu">
      <Backdrop />
      <div className="menu-bg" aria-hidden="true" />
      <header className="menu-top">
        {user && (
          <div className="user-chip">
            <span>{user.username}</span>
            <Money cents={user.balanceCents} className="user-chip__balance" />
            <small>TEST USDC</small>
            <button className="link-btn" onClick={() => session.clear()}>
              Log out
            </button>
          </div>
        )}
      </header>
      <main className="menu-main">
        <h1 className="logo">
          EXTRACT<span>.IO</span>
        </h1>
        <p className="tagline">
          100 PLAYERS.
          <br />
          10 MINUTES.
          <br />
          <em>ONE WAY OUT.</em>
        </p>
        {!user ? (
          <EntryForm />
        ) : (
          <nav className="menu-nav">
            <Button variant="primary" size="lg" onClick={() => navigate('play')}>
              Play
            </Button>
            <Button size="lg" onClick={() => navigate('inventory')}>
              Inventory
            </Button>
            <Button size="lg" onClick={() => navigate('marketplace')}>
              Marketplace
            </Button>
            <Button size="lg" onClick={() => navigate('leaderboard')}>
              Leaderboard
            </Button>
            <Button size="lg" onClick={() => navigate('profile')}>
              Profile
            </Button>
          </nav>
        )}
      </main>
      <footer className="menu-footer">
        <span>SEASON {CURRENT_SEASON.number}</span>
        <strong>{CURRENT_SEASON.name}</strong>
      </footer>
    </div>
  );
}
