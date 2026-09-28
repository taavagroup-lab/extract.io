import type {
  AuthResponse,
  InventoryItemDTO,
  LeaderboardCategory,
  LeaderboardDTO,
  LeaderboardPeriod,
  ListingDTO,
  ListingQuery,
  Paginated,
  ProfileDTO,
  PublicConfigDTO,
  SeasonDTO,
  ServerStatusDTO,
  TransactionDTO,
  UserDTO,
  WalletDTO,
} from '@extract/game-types';
import { session } from './session';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const token = session.get().token;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'API unreachable. Is `pnpm dev` running?');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 401 && token) session.clear();
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const api = {
  guest: (username: string) => request<AuthResponse>('POST', '/auth/guest', { username }),
  login: (username: string, password: string) => request<AuthResponse>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string) => request<AuthResponse>('POST', '/auth/register', { username, password }),
  me: () => request<UserDTO>('GET', '/me'),

  inventory: () => request<InventoryItemDTO[]>('GET', '/inventory'),
  mint: (id: string) => request<InventoryItemDTO>('POST', `/inventory/${id}/mint`),

  listings: (q: ListingQuery) => request<Paginated<ListingDTO>>('GET', `/marketplace/listings${qs({ ...q })}`),
  myListings: () => request<ListingDTO[]>('GET', '/marketplace/my-listings'),
  history: () => request<TransactionDTO[]>('GET', '/marketplace/history'),
  createListing: (inventoryItemId: string, quantity: number, priceCents: number) =>
    request<ListingDTO>('POST', '/marketplace/listings', { inventoryItemId, quantity, priceCents }),
  cancelListing: (id: string) => request<void>('DELETE', `/marketplace/listings/${id}`),
  buy: (id: string, idempotencyKey: string) =>
    request<TransactionDTO>('POST', `/marketplace/listings/${id}/buy`, undefined, { 'idempotency-key': idempotencyKey }),

  leaderboard: (category: LeaderboardCategory, period: LeaderboardPeriod, page = 1, pageSize = 25) =>
    request<LeaderboardDTO>('GET', `/leaderboard${qs({ category, period, page, pageSize })}`),
  profile: () => request<ProfileDTO>('GET', '/profile'),
  season: () => request<SeasonDTO>('GET', '/seasons/current'),

  config: () => request<PublicConfigDTO>('GET', '/config'),
  status: () => request<ServerStatusDTO>('GET', '/status'),

  wallet: () => request<{ wallet: WalletDTO | null }>('GET', '/wallet'),
  connectWallet: () => request<WalletDTO>('POST', '/wallet/connect', {}),
  disconnectWallet: () => request<void>('DELETE', '/wallet'),
};
