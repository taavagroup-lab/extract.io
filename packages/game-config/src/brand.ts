/**
 * Visual branding. Technical identifiers (package names, DB, protocol) stay
 * "extract"/"extract-io"; only player-facing copy uses these values.
 */
export const BRAND = {
  /** Game identity. */
  game: 'EXTRACT',
  /** Brand / social identity: rendered as "EXTRACT" + accent ".SOL". */
  wordmark: 'EXTRACT',
  wordmarkSuffix: '.SOL',
  /** Where the web game lives. */
  domain: 'extract.io',
  url: 'https://extract.io',
  tagline: ['100 PLAYERS.', '10 MINUTES.', 'ONE WAY OUT.'] as const,
  slogan: ['GET IN.', 'GET THE BAG.', 'GET OUT.'] as const,
} as const;

export const BRAND_NAME = `${BRAND.wordmark}${BRAND.wordmarkSuffix}`;

/** Deliberately no "LIVE"/"TRADING" state: the product never presents a tradable token. */
export const TOKEN_STATUSES = ['COMING_SOON', 'COMMUNITY'] as const;
export type TokenStatus = (typeof TOKEN_STATUSES)[number];

/**
 * $EXTRACT community/token identity. Placeholder only: there is no tradable
 * token, price, market cap or holder count anywhere in the product.
 * Overridden at runtime by TOKEN_* environment variables (API /config).
 */
export const TOKEN_DEFAULTS = {
  enabled: true,
  status: 'COMING_SOON' as TokenStatus,
  symbol: '$EXTRACT',
  chain: 'Solana',
};

export const CURRENCY_MODES = ['TEST', 'LIVE'] as const;
export type CurrencyMode = (typeof CURRENCY_MODES)[number];

/**
 * Stable reference currency for values and the marketplace. In TEST mode every
 * amount is labelled "TEST USDC" so nobody mistakes it for real money.
 * Overridden at runtime by CURRENCY_MODE (API /config).
 */
export const CURRENCY_DEFAULTS = {
  code: 'USDC',
  mode: 'TEST' as CurrencyMode,
};
