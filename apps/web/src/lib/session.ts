import type { AuthResponse, UserDTO } from '@extract/game-types';
import { Store } from './store';

interface SessionState {
  token: string | null;
  user: UserDTO | null;
}

/**
 * `?slot=2` keeps a separate session per slot, so two tabs of the same
 * browser can play as two different players (local multiplayer testing).
 */
const slot = new URLSearchParams(window.location.search).get('slot');
const KEY = slot && /^[\w-]{1,16}$/.test(slot) ? `extractio.session.${slot}` : 'extractio.session';

function load(): SessionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as SessionState;
  } catch {
    // storage unavailable (private mode): start logged out
  }
  return { token: null, user: null };
}

class SessionStore extends Store<SessionState> {
  constructor() {
    super(load());
  }

  private persist(v: SessionState): void {
    try {
      if (v.token) localStorage.setItem(KEY, JSON.stringify(v));
      else localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }

  signIn(auth: AuthResponse): void {
    const v = { token: auth.token, user: auth.user };
    this.persist(v);
    this.set(v);
  }

  setUser(user: UserDTO): void {
    const v = { ...this.get(), user };
    this.persist(v);
    this.set(v);
  }

  clear(): void {
    this.persist({ token: null, user: null });
    this.set({ token: null, user: null });
  }
}

export const session = new SessionStore();
