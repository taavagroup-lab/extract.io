import { Button, Money } from '@extract/ui';
import type { ReactNode } from 'react';
import { navigate } from '../lib/router';
import { session } from '../lib/session';
import { useStore } from '../lib/store';

export function PageShell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const { user } = useStore(session);
  return (
    <div className="page">
      <header className="page-header">
        <button className="brand" onClick={() => navigate('menu')}>
          EXTRACT<span>.IO</span>
        </button>
        <h1 className="page-title">{title}</h1>
        <div className="page-header__right">
          {actions}
          {user && (
            <div className="user-chip">
              <span>{user.username}</span>
              <Money cents={user.balanceCents} className="user-chip__balance" />
              <small>TEST USDC</small>
            </div>
          )}
          <Button variant="primary" size="sm" onClick={() => navigate('play')}>
            Play
          </Button>
        </div>
      </header>
      <main className="page-body">{children}</main>
    </div>
  );
}
