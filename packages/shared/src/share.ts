import { BRAND, BRAND_NAME, RARITY_CONFIG } from '@extract/game-config';
import type { Rarity } from '@extract/game-types';
import { formatMoney, type CurrencyDisplay } from './money';

export interface ShareResult {
  playerName: string;
  kills: number;
  bagValueCents: number;
  rarityCounts: Partial<Record<Rarity, number>>;
  seasonNumber: number;
  seasonName: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Rarities worth bragging about, best first; falls back to EPIC when nothing better dropped. */
export function shareRarityLines(counts: Partial<Record<Rarity, number>>): { rarity: Rarity; count: number; label: string }[] {
  const top = (['MYTHIC', 'LEGENDARY'] as const).filter((r) => (counts[r] ?? 0) > 0);
  const picked: Rarity[] = top.length > 0 ? [...top] : (counts.EPIC ?? 0) > 0 ? ['EPIC'] : [];
  return picked.map((r) => ({ rarity: r, count: counts[r]!, label: RARITY_CONFIG[r].label.toUpperCase() }));
}

/** Short uppercase lines for the result card: "6 KILLS", "84.72 TEST USDC BAG", "1 LEGENDARY". */
export function shareHighlights(r: ShareResult, cur?: CurrencyDisplay): string[] {
  return [
    plural(r.kills, 'KILL', 'KILLS'),
    `${formatMoney(r.bagValueCents, cur)} BAG`,
    ...shareRarityLines(r.rarityCounts).map((l) => `${l.count} ${l.label}`),
  ];
}

/** Prefilled post text. Never claims real value while the currency is in TEST mode. */
export function buildShareText(r: ShareResult, cur?: CurrencyDisplay): string {
  const lines = [`Just extracted a ${formatMoney(r.bagValueCents, cur)} bag in ${BRAND_NAME}.`, ''];
  lines.push(`${plural(r.kills, 'kill')}.`);
  for (const l of shareRarityLines(r.rarityCounts)) lines.push(`${l.count} ${l.label.toLowerCase()}.`);
  lines.push('Made it out alive.', '', BRAND.domain);
  return lines.join('\n');
}

/** X web intent (no API integration needed). */
export function xIntentUrl(text: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
