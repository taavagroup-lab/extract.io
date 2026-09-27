import { RARITY_CONFIG } from '@extract/game-config';
import type { ItemType, Rarity } from '@extract/game-types';
import { formatCents } from '@extract/shared';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return <button className={`x-btn x-btn--${variant} x-btn--${size} ${className}`} {...rest} />;
}

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`x-panel ${className}`}>
      {(title || actions) && (
        <header className="x-panel__header">
          {title && <h2 className="x-panel__title">{title}</h2>}
          {actions && <div className="x-panel__actions">{actions}</div>}
        </header>
      )}
      <div className="x-panel__body">{children}</div>
    </section>
  );
}

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  const cfg = RARITY_CONFIG[rarity];
  return (
    <span className="x-rarity" style={{ color: cfg.color, borderColor: `${cfg.color}66`, background: `${cfg.color}14` }}>
      {cfg.label}
    </span>
  );
}

export function Money({ cents, className = '' }: { cents: number; className?: string }) {
  return <span className={`x-money ${className}`}>{formatCents(cents)}</span>;
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="x-tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={`x-tab ${o.value === value ? 'x-tab--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="x-spinner">
      <span className="x-spinner__dot" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="x-empty">
      <p className="x-empty__title">{title}</p>
      {children && <div className="x-empty__body">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="x-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="x-modal__card">
        <header className="x-modal__header">
          <h3>{title}</h3>
          <button className="x-modal__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const TYPE_GLYPH: Record<ItemType, ReactNode> = {
  WEAPON: <path d="M4 14h11l2-2h3v3h-3l-1 1h-3l-1 3H9l1-3H4z" />,
  AMMO: (
    <>
      <rect x="6" y="7" width="3" height="10" rx="1.5" />
      <rect x="10.5" y="7" width="3" height="10" rx="1.5" />
      <rect x="15" y="7" width="3" height="10" rx="1.5" />
    </>
  ),
  CONSUMABLE: <path d="M10 5h4v5h5v4h-5v5h-4v-5H5v-4h5z" />,
  VALUABLE: <path d="M12 4l7 7-7 9-7-9z" />,
  COSMETIC: <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z" />,
};

/** Placeholder item icon: rarity frame + type glyph. Swap for real art later. */
export function ItemIcon({ type, rarity, size = 36 }: { type: ItemType; rarity: Rarity; size?: number }) {
  const color = RARITY_CONFIG[rarity].color;
  return (
    <svg className="x-item-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="5" fill={`${color}22`} stroke={color} strokeWidth="1.5" />
      <g fill={color}>{TYPE_GLYPH[type]}</g>
    </svg>
  );
}
