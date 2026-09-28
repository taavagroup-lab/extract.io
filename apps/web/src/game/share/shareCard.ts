import { BRAND, CURRENT_SEASON, RARITY_CONFIG, getItemDef } from '@extract/game-config';
import type { ItemAmount } from '@extract/game-types';
import { formatAmount, formatMoney, shareHighlights, type CurrencyDisplay, type ShareResult } from '@extract/shared';

export const SHARE_CARD_W = 1200;
export const SHARE_CARD_H = 675;

const BG = '#050607';
const TEXT = '#eceee6';
const MUTED = '#9aa197';
const DIM = '#5d655d';
const ACCENT = '#b8f53d';
const DISPLAY = '"Chakra Petch", "Rajdhani", "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

async function ensureFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  await Promise.all([
    document.fonts.load(`700 64px ${DISPLAY}`),
    document.fonts.load(`600 20px ${DISPLAY}`),
    document.fonts.load(`700 40px ${MONO}`),
  ]).catch(() => undefined);
}

function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): number {
  // letterSpacing is not everywhere yet: draw per glyph.
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  return cx - spacing;
}

function background(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SHARE_CARD_W, SHARE_CARD_H);
  const glow = ctx.createRadialGradient(260, 330, 0, 260, 330, 620);
  glow.addColorStop(0, 'rgba(184,245,61,0.16)');
  glow.addColorStop(1, 'rgba(184,245,61,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SHARE_CARD_W, SHARE_CARD_H);
  ctx.strokeStyle = 'rgba(232,240,220,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0.5; x < SHARE_CARD_W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, SHARE_CARD_H);
    ctx.stroke();
  }
  for (let y = 0.5; y < SHARE_CARD_H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SHARE_CARD_W, y);
    ctx.stroke();
  }
  // corner brackets
  ctx.strokeStyle = 'rgba(232,240,220,0.4)';
  ctx.lineWidth = 2;
  const b = 28;
  const m = 26;
  for (const [x, y, dx, dy] of [
    [m, m, 1, 1],
    [SHARE_CARD_W - m, m, -1, 1],
    [m, SHARE_CARD_H - m, 1, -1],
    [SHARE_CARD_W - m, SHARE_CARD_H - m, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * b);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * b, y);
    ctx.stroke();
  }
}

/**
 * Renders the 1200x675 result card for X. Values are formatted with the
 * configured currency (TEST USDC while the economy is not real money).
 */
export async function renderShareCard(result: ShareResult, items: ItemAmount[], cur: CurrencyDisplay): Promise<Blob> {
  await ensureFonts();
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD_W;
  canvas.height = SHARE_CARD_H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';
  background(ctx);

  // Header: wordmark + season
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillStyle = TEXT;
  ctx.fillText(BRAND.wordmark, 64, 100);
  const w = ctx.measureText(BRAND.wordmark).width;
  ctx.fillStyle = ACCENT;
  ctx.shadowColor = 'rgba(184,245,61,0.6)';
  ctx.shadowBlur = 18;
  ctx.fillText(BRAND.wordmarkSuffix, 64 + w, 100);
  ctx.shadowBlur = 0;
  ctx.font = `600 16px ${DISPLAY}`;
  ctx.fillStyle = DIM;
  ctx.textAlign = 'right';
  ctx.fillText(`SEASON ${result.seasonNumber} — ${result.seasonName}`, SHARE_CARD_W - 64, 94);
  ctx.textAlign = 'left';

  // Title block
  ctx.font = `600 20px ${DISPLAY}`;
  ctx.fillStyle = ACCENT;
  spaced(ctx, 'EXTRACTION SUCCESSFUL', 64, 196, 5);
  ctx.font = `700 96px ${DISPLAY}`;
  ctx.fillStyle = TEXT;
  ctx.fillText('BAG SECURED', 58, 290);

  // Highlights
  const lines = shareHighlights(result, cur);
  let y = 356;
  lines.forEach((line, i) => {
    const rarity = i >= 2 ? (['MYTHIC', 'LEGENDARY', 'EPIC'] as const).find((r) => line.endsWith(RARITY_CONFIG[r].label.toUpperCase())) : undefined;
    ctx.font = i === 1 ? `700 44px ${MONO}` : `700 38px ${DISPLAY}`;
    ctx.fillStyle = rarity ? RARITY_CONFIG[rarity].color : i === 1 ? ACCENT : TEXT;
    ctx.fillText(line, 64, y);
    y += i === 1 ? 56 : 46;
  });

  // Player
  ctx.font = `600 16px ${DISPLAY}`;
  ctx.fillStyle = DIM;
  spaced(ctx, 'OPERATOR', 64, 562, 4);
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.fillStyle = TEXT;
  ctx.fillText(result.playerName.toUpperCase(), 64, 598);

  // Right column: best items
  const top = [...items]
    .map((i) => ({ i, def: getItemDef(i.itemId) }))
    .filter((x) => !x.def.metadata.starter && x.def.estimatedValue > 0)
    .sort((a, b) => RARITY_CONFIG[b.def.rarity].rank - RARITY_CONFIG[a.def.rarity].rank || b.def.estimatedValue * b.i.qty - a.def.estimatedValue * a.i.qty)
    .slice(0, 5);
  const colX = 760;
  let rowY = 196;
  if (top.length > 0) {
    ctx.font = `600 14px ${DISPLAY}`;
    ctx.fillStyle = DIM;
    spaced(ctx, 'SECURED', colX, rowY - 20, 4);
  }
  for (const { i, def } of top) {
    const color = RARITY_CONFIG[def.rarity].color;
    ctx.fillStyle = 'rgba(12,15,18,0.9)';
    ctx.fillRect(colX, rowY, 376, 58);
    ctx.fillStyle = color;
    ctx.fillRect(colX, rowY, 3, 58);
    // rarity diamond
    ctx.save();
    ctx.translate(colX + 30, rowY + 29);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillRect(-7, -7, 14, 14);
    ctx.restore();
    ctx.font = `700 19px ${DISPLAY}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(`${def.name.toUpperCase()}${i.qty > 1 ? ` ×${i.qty}` : ''}`, colX + 56, rowY + 27);
    ctx.font = `600 12px ${DISPLAY}`;
    ctx.fillStyle = color;
    ctx.fillText(RARITY_CONFIG[def.rarity].label.toUpperCase(), colX + 56, rowY + 46);
    ctx.font = `500 14px ${MONO}`;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    const v = def.estimatedValue * i.qty;
    ctx.fillText(cur.mode === 'TEST' ? formatAmount(v) : formatMoney(v, cur), colX + 362, rowY + 35);
    ctx.textAlign = 'left';
    rowY += 66;
  }

  // Footer
  ctx.font = `600 16px ${DISPLAY}`;
  ctx.fillStyle = MUTED;
  spaced(ctx, BRAND.slogan.join(' '), 760, 598, 4);
  ctx.font = `700 22px ${DISPLAY}`;
  ctx.fillStyle = ACCENT;
  ctx.textAlign = 'right';
  ctx.fillText(BRAND.domain, SHARE_CARD_W - 64, 562);
  ctx.textAlign = 'left';
  if (cur.mode === 'TEST') {
    ctx.font = `500 12px ${DISPLAY}`;
    ctx.fillStyle = DIM;
    ctx.fillText('Test economy · values have no real-money worth', 64, 636);
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

export function seasonShareFields(): Pick<ShareResult, 'seasonNumber' | 'seasonName'> {
  return { seasonNumber: CURRENT_SEASON.number, seasonName: CURRENT_SEASON.name };
}
