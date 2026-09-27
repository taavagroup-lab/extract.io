import { useEffect, useState, useSyncExternalStore } from 'react';
import type { GameClient, HudState } from '../net/GameClient';

export function useHud(client: GameClient): HudState {
  return useSyncExternalStore(client.subscribe, client.getHud, client.getHud);
}

/** Re-renders at a fixed rate (for clocks / smooth progress). */
export function useTicker(intervalMs: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
