import { Button } from '@extract/ui';
import type { ReactNode } from 'react';
import { Usdc, Wordmark } from '../components/Brand';
import { navigate, useRoute, type Route } from '../lib/router';
import { session } from '../lib/session';
import { useStore } from '../lib/store';

const LINKS: { route: Route; label: string }[] = [
  { route: 'inventory', label: 'Inventory' },
  { route: 'marketplace', label: 'Market' },
  { route: 'leaderboard', label: 'Leaderboard' },
  { route: 'profile', label: 'Profile' },
];

export function PageShell({
  title,
  kicker,
  children,
  actions,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { user } = useStore(session);
  const route = useRoute();
  return (
    <div className="page">
      <header className="page-header">
        <button className="page-brand" onClick={() => navigate('menu')} aria-label="Main menu">
          <Wordmark />
        </button>
        <nav className="main-nav" aria-label="Main">
          {LINKS.map((l) => (
            <button
              key={l.route}
              className={`main-nav__link ${route === l.route ? 'is-active' : ''}`}
              aria-current={route === l.route ? 'page' : undefined}
              onClick={() => navigate(l.route)}
            >
              {l.label}
            </button>
          ))}
        </nav>
        <div className="page-header__right">
          {user && (
            <div className="user-chip">
              <span className="user-chip__name">{user.username}</span>
              <Usdc cents={user.balanceCents} className="user-chip__balance" />
            </div>
          )}
          <Button variant="primary" size="sm" onClick={() => navigate('play')}>
            Play
          </Button>
        </div>
      </header>
      <main className="page-body">
        <div className="page-intro">
          {kicker && <p className="x-kicker">{kicker}</p>}
          <h1 className="page-title">{title}</h1>
          {actions && <div className="page-intro__actions">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}
