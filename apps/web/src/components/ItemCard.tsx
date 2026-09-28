import { RARITY_CONFIG } from '@extract/game-config';
import type { ItemType, Rarity } from '@extract/game-types';
import { ItemIcon, RarityBadge } from '@extract/ui';
import type { CSSProperties, ReactNode } from 'react';

/** "#042 / 1000" (serials only exist for limited items; never invented). */
export function formatSerial(serial: number, maxSupply: number | null): string {
  const n = String(serial).padStart(3, '0');
  return maxSupply ? `#${n} / ${maxSupply}` : `#${n}`;
}

/** "GENESIS ITEM" for a limited item of season "THE GENESIS". */
export function limitedLabel(seasonName: string | null): string | null {
  return seasonName ? `${seasonName.replace(/^THE\s+/i, '')} ITEM` : null;
}

interface Props {
  name: string;
  type: ItemType;
  rarity: Rarity;
  icon: string;
  quantity?: number;
  /** Small uppercase line above the name (e.g. GENESIS ITEM). */
  kicker?: string | null;
  badges?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  muted?: boolean;
}

/** Premium item presentation shared by inventory and market. */
export function ItemCard({ name, type, rarity, icon, quantity = 1, kicker, badges, children, footer, muted = false }: Props) {
  const cfg = RARITY_CONFIG[rarity];
  const style = { '--rarity': cfg.color } as CSSProperties;
  return (
    <article className={`item-card rarity-${rarity.toLowerCase()} ${muted ? 'is-muted' : ''}`} style={style}>
      <div className="item-card__media">
        <ItemIcon type={type} rarity={rarity} icon={icon} size={58} />
        {quantity > 1 && <span className="item-card__qty">×{quantity}</span>}
      </div>
      <div className="item-card__head">
        <div className="item-card__tags">
          <RarityBadge rarity={rarity} />
          {badges}
        </div>
        {kicker && <p className="item-card__kicker">{kicker}</p>}
        <h3 className="item-card__name">{name}</h3>
      </div>
      {children && <div className="item-card__body">{children}</div>}
      {footer && <div className="item-card__footer">{footer}</div>}
    </article>
  );
}

export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="meta-row">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

export function rarityStyle(rarity: Rarity): CSSProperties {
  return { color: RARITY_CONFIG[rarity].color };
}
