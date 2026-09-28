import { CURRENCY_DEFAULTS, TOKEN_DEFAULTS } from '@extract/game-config';
import type { PublicConfigDTO } from '@extract/game-types';
import { currencyUnit, formatMoney } from '@extract/shared';
import { api } from './api';
import { Store, useStore } from './store';

/** Runtime config from the API (/config). Starts with the safe defaults (TEST currency). */
export const publicConfig = new Store<PublicConfigDTO>({
  token: { ...TOKEN_DEFAULTS },
  currency: { ...CURRENCY_DEFAULTS },
});

let loading: Promise<void> | null = null;

export function loadPublicConfig(): Promise<void> {
  loading ??= api
    .config()
    .then((cfg) => publicConfig.set(cfg))
    .catch(() => {
      loading = null; // retry on next call; defaults stay in place
    });
  return loading;
}

export function useCurrency() {
  const { currency } = useStore(publicConfig);
  return { currency, unit: currencyUnit(currency), format: (cents: number) => formatMoney(cents, currency) };
}

/** Non-React access (renderer, share card). */
export function currentCurrency() {
  return publicConfig.get().currency;
}
