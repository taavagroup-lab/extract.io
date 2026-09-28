import { CURRENCY_DEFAULTS, type CurrencyMode } from '@extract/game-config';

export interface CurrencyDisplay {
  code: string;
  mode: CurrencyMode;
}

/** 8472 -> "84.72", 1234567 -> "12,345.67" (no symbol). */
export function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/** "TEST USDC" while values are not real money, "USDC" in production. */
export function currencyUnit(cur: CurrencyDisplay = CURRENCY_DEFAULTS): string {
  return cur.mode === 'TEST' ? `TEST ${cur.code}` : cur.code;
}

/**
 * Player-facing amount. TEST mode always spells out the unit so a value can
 * never be mistaken for real money: "84.72 TEST USDC". LIVE mode: "$84.72".
 */
export function formatMoney(cents: number, cur: CurrencyDisplay = CURRENCY_DEFAULTS): string {
  if (cur.mode === 'TEST') return `${formatAmount(cents)} ${currencyUnit(cur)}`;
  const amount = formatAmount(Math.abs(cents));
  return `${cents < 0 ? '-' : ''}$${amount}`;
}
