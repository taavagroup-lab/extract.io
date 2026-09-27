import { RARITY_CONFIG } from '@extract/game-config';
import type { ItemType, Rarity } from '@extract/game-types';
import { formatCents } from '@extract/shared';
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';

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

const INK = '#0b0f15';

/** Per-item glyphs keyed by ItemDefinition.icon (24x24 viewBox). */
const ICON_GLYPH: Record<string, ReactNode> = {
  pistol: <path d="M4 8.5h13l1 1.2h2v3h-6.2l-1 2.2h-3l-1.1 4.3H5.8l1.1-4.3H4z" />,
  smg: (
    <>
      <path d="M2.5 9h14.5l1.6 1H21v2.2h-4v1.3h-5.2l-1.2 5H8.3l1.2-5H2.5z" />
      <rect x="12.4" y="13.4" width="2.4" height="5.6" rx="0.6" />
    </>
  ),
  rifle: <path d="M1.5 10.2h3l1-1.2h11.2l1 1.2H22v2.1h-4.2l-1.3 1.1h-3.2l-1.1 5.1H9.3l1.1-5.1H6l-1.2 1.2H1.5z" />,
  shotgun: (
    <>
      <path d="M1.5 10.8H21v2.4H9.6l-1.2 4.6H5.3l1.2-4.6h-5z" />
      <rect x="12.5" y="13.3" width="5.5" height="2.6" rx="0.8" />
    </>
  ),
  ammo_light: (
    <>
      <path d="M6 19v-7.5a2 2 0 014 0V19z" />
      <path d="M10.8 19v-9a2.2 2.2 0 014.4 0v9z" />
      <path d="M16 19v-7.5a2 2 0 014 0V19z" />
    </>
  ),
  ammo_rifle: (
    <>
      <path d="M5.5 20V9.5a2 2 0 012-3 2 2 0 012 3V20z" />
      <path d="M10.5 20V7.5a2 2 0 012-3 2 2 0 012 3V20z" />
      <path d="M15.5 20V9.5a2 2 0 012-3 2 2 0 012 3V20z" />
    </>
  ),
  ammo_shell: (
    <>
      <rect x="4.5" y="7" width="4.4" height="12" rx="1.2" />
      <rect x="9.8" y="7" width="4.4" height="12" rx="1.2" />
      <rect x="15.1" y="7" width="4.4" height="12" rx="1.2" />
    </>
  ),
  medkit: (
    <>
      <rect x="3.5" y="6.5" width="17" height="13" rx="2.2" />
      <path d="M9 4.5h6v2H9z" />
      <path fill={INK} d="M10.8 9h2.4v2.6h2.6V14h-2.6v2.6h-2.4V14H8.2v-2.4h2.6z" />
    </>
  ),
  armor: (
    <>
      <path d="M12 2.8l7.5 3v5.3c0 5.1-3.2 8.6-7.5 10.3-4.3-1.7-7.5-5.2-7.5-10.3V5.8z" />
      <path fill={INK} opacity="0.35" d="M12 5.2v14.2c-3-1.5-5.2-4.3-5.2-8.2V7.4z" />
    </>
  ),
  scrap: (
    <path
      fillRule="evenodd"
      d="M10.4 3h3.2l.6 2.4 1.9.8 2.1-1.3 2.3 2.3-1.3 2.1.8 1.9 2.4.6v3.2l-2.4.6-.8 1.9 1.3 2.1-2.3 2.3-2.1-1.3-1.9.8-.6 2.4h-3.2l-.6-2.4-1.9-.8-2.1 1.3-2.3-2.3 1.3-2.1-.8-1.9L3 13.6v-3.2l2.4-.6.8-1.9-1.3-2.1 2.3-2.3 2.1 1.3 1.9-.8zM12 8.8a3.2 3.2 0 100 6.4 3.2 3.2 0 000-6.4z"
    />
  ),
  wire: (
    <g fill="none" stroke="currentColor" strokeWidth="1.9">
      <ellipse cx="12" cy="7.5" rx="7" ry="2.6" />
      <ellipse cx="12" cy="12" rx="7" ry="2.6" />
      <ellipse cx="12" cy="16.5" rx="7" ry="2.6" />
    </g>
  ),
  circuit: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.6" />
      <rect x="9" y="9" width="6" height="6" rx="0.8" fill={INK} opacity="0.55" />
      {[8, 12, 16].map((p) => (
        <g key={p}>
          <rect x={p - 0.8} y="2.5" width="1.6" height="3" />
          <rect x={p - 0.8} y="18.5" width="1.6" height="3" />
          <rect x="2.5" y={p - 0.8} width="3" height="1.6" />
          <rect x="18.5" y={p - 0.8} width="3" height="1.6" />
        </g>
      ))}
    </>
  ),
  gold: (
    <>
      <path d="M2.5 18.5l3.2-8.5h12.6l3.2 8.5z" />
      <path fill="#ffffff" opacity="0.45" d="M7.2 11.3h9.6l.7 1.8H6.5z" />
    </>
  ),
  core: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <g fill="none" stroke="currentColor" strokeWidth="1.3">
        <ellipse cx="12" cy="12" rx="9.2" ry="3.4" />
        <ellipse cx="12" cy="12" rx="9.2" ry="3.4" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="9.2" ry="3.4" transform="rotate(-60 12 12)" />
      </g>
    </>
  ),
  fragment: (
    <>
      <path d="M12.5 2.5l6 7.5-3.6 11.5-7.6-7.2z" />
      <path fill="#ffffff" opacity="0.4" d="M12.5 2.5l-5.2 11.8 2.3 2.2z" />
    </>
  ),
  skin: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path fill={INK} opacity="0.5" d="M12 7.2l1.3 3.2 3.2 1.3-3.2 1.3L12 16.2l-1.3-3.2-3.2-1.3 3.2-1.3z" />
    </>
  ),
  katana: (
    <>
      <path d="M20.8 2.6l.6.6-11.3 12.6-1.9-1.9z" />
      <path d="M6.2 14.5l3.3 3.3-1.2 1.2-3.3-3.3z" />
      <path d="M5.6 17.5l1 1-3.1 3.1-1-1z" />
    </>
  ),
  crown: (
    <>
      <path d="M3.2 17.2l-1-9.5 5.2 4.3L12 4.8l4.6 7.2 5.2-4.3-1 9.5z" />
      <rect x="3.4" y="18.2" width="17.2" height="2.6" rx="0.8" />
      <circle cx="12" cy="13.6" r="1.6" fill="#fecaca" />
    </>
  ),
};

/** Item icon: rarity frame + per-item glyph with a rarity gradient (glow for EPIC+). */
export function ItemIcon({ type, rarity, icon, size = 36 }: { type: ItemType; rarity: Rarity; icon?: string; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const cfg = RARITY_CONFIG[rarity];
  const color = cfg.color;
  const glyph = (icon ? ICON_GLYPH[icon] : undefined) ?? TYPE_GLYPH[type];
  const glowStyle = cfg.rank >= 2 ? { filter: `drop-shadow(0 0 ${2 + cfg.rank}px ${color}aa)` } : undefined;
  return (
    <svg className="x-item-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ color, ...glowStyle }}>
      <defs>
        <radialGradient id={`bg${uid}`} cx="50%" cy="30%" r="80%">
          <stop offset="0" stopColor={color} stopOpacity="0.32" />
          <stop offset="1" stopColor={color} stopOpacity="0.04" />
        </radialGradient>
        <linearGradient id={`fg${uid}`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="5" fill={`url(#bg${uid})`} stroke={color} strokeOpacity="0.9" strokeWidth="1.3" />
      <g fill={`url(#fg${uid})`}>{glyph}</g>
    </svg>
  );
}
