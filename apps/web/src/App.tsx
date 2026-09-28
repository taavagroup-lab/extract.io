import { Spinner } from '@extract/ui';
import { Suspense, lazy, useEffect } from 'react';
import { installUiSounds } from './components/uiSounds';
import { navigate, useRoute } from './lib/router';
import { loadPublicConfig } from './lib/publicConfig';
import { session } from './lib/session';
import { useStore } from './lib/store';
import { InventoryPage } from './pages/InventoryPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { MainMenu } from './pages/MainMenu';
import { MarketplacePage } from './pages/MarketplacePage';
import { ProfilePage } from './pages/ProfilePage';

// The Three.js game client is only downloaded when a match starts.
const PlayPage = lazy(() => import('./pages/PlayPage').then((m) => ({ default: m.PlayPage })));

export function App() {
  const route = useRoute();
  const { token } = useStore(session);

  useEffect(() => {
    void loadPublicConfig();
    installUiSounds();
  }, []);

  // Every page except the menu requires a (guest) session.
  useEffect(() => {
    if (!token && route !== 'menu') navigate('menu');
  }, [token, route]);

  if (!token) return <MainMenu />;
  switch (route) {
    case 'play':
      return (
        <Suspense fallback={<div className="raid-screen"><Spinner label="Loading game…" /></div>}>
          <PlayPage />
        </Suspense>
      );
    case 'inventory':
      return <InventoryPage />;
    case 'marketplace':
      return <MarketplacePage />;
    case 'leaderboard':
      return <LeaderboardPage />;
    case 'profile':
      return <ProfilePage />;
    default:
      return <MainMenu />;
  }
}
