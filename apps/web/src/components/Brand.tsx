import { BRAND, CURRENT_SEASON } from '@extract/game-config';
import { Money } from '@extract/ui';
import { useStore } from '../lib/store';
import { publicConfig, useCurrency } from '../lib/publicConfig';

/** EXTRACT.SOL wordmark (".SOL" in the accent colour). */
export function Wordmark({ className = '', as: Tag = 'span' }: { className?: string; as?: 'span' | 'h1' }) {
  return (
    <Tag className={`wordmark ${className}`} aria-label={`${BRAND.wordmark}${BRAND.wordmarkSuffix}`}>
      <span className="wordmark__main">{BRAND.wordmark}</span>
      <span className="wordmark__suffix">{BRAND.wordmarkSuffix}</span>
    </Tag>
  );
}

export function SeasonBadge({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`season-badge ${compact ? 'is-compact' : ''}`}>
      <span className="season-badge__num">SEASON {CURRENT_SEASON.number}</span>
      <span className="season-badge__name">{CURRENT_SEASON.name}</span>
    </div>
  );
}

const TOKEN_STATUS_LABEL = { COMING_SOON: 'COMING SOON', COMMUNITY: 'COMMUNITY' } as const;

/** $EXTRACT community identity. Placeholder only: no price, market cap or holders, by design. */
export function TokenBadge() {
  const { token } = useStore(publicConfig);
  if (!token.enabled) return null;
  return (
    <div className="token-badge" title={`${token.symbol} · ${token.chain}`}>
      <span className="token-badge__symbol">{token.symbol}</span>
      <span className="token-badge__status">{TOKEN_STATUS_LABEL[token.status]}</span>
      <span className="token-badge__chain">{token.chain.toUpperCase()}</span>
    </div>
  );
}

/** Amount in the configured reference currency ("84.72 TEST USDC" in test mode). */
export function Usdc({ cents, className = '' }: { cents: number; className?: string }) {
  const { currency, unit } = useCurrency();
  return currency.mode === 'TEST' ? <Money cents={cents} unit={unit} className={className} /> : <Money cents={cents} className={className} />;
}
