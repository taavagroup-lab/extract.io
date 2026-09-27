import { RARITY_CONFIG } from '@extract/game-config';
import { CONTAINER_TYPES, ITEM_TYPES, RARITIES, type ContainerType, type ItemType, type Rarity } from '@extract/game-types';
import Phaser from 'phaser';
import { PALETTE } from './palette';

export const ITEM_TEX_SIZE = 30;
export const CRATE_TEX_SIZE = 46;

export const itemTexture = (type: ItemType, rarity: Rarity) => `item_${type}_${rarity}`;
export const crateTexture = (type: ContainerType, opened: boolean) => `crate_${type}${opened ? '_open' : ''}`;

function drawGlyph(g: Phaser.GameObjects.Graphics, type: ItemType, cx: number, cy: number, color: number): void {
  g.fillStyle(color, 1);
  switch (type) {
    case 'WEAPON':
      g.fillRect(cx - 9, cy - 2, 16, 5);
      g.fillRect(cx - 9, cy + 1, 5, 6);
      break;
    case 'AMMO':
      for (const dx of [-6, 0, 6]) g.fillRoundedRect(cx + dx - 2, cy - 6, 4, 12, 2);
      break;
    case 'CONSUMABLE':
      g.fillRect(cx - 2.5, cy - 8, 5, 16);
      g.fillRect(cx - 8, cy - 2.5, 16, 5);
      break;
    case 'VALUABLE':
      g.fillTriangle(cx, cy - 8, cx + 8, cy, cx - 8, cy);
      g.fillTriangle(cx - 8, cy, cx + 8, cy, cx, cy + 9);
      break;
    case 'COSMETIC': {
      const pts: Phaser.Types.Math.Vector2Like[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 9 : 4;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      g.fillPoints(pts, true);
      break;
    }
  }
}

/** Generates all placeholder textures once per game instance. */
export function generateTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  for (const type of ITEM_TYPES) {
    for (const rarity of RARITIES) {
      const key = itemTexture(type, rarity);
      if (scene.textures.exists(key)) continue;
      const color = RARITY_CONFIG[rarity].colorHex;
      const s = ITEM_TEX_SIZE;
      g.clear();
      g.fillStyle(0x0b0f15, 0.92);
      g.fillRoundedRect(1, 1, s - 2, s - 2, 7);
      g.lineStyle(2, color, 1);
      g.strokeRoundedRect(1, 1, s - 2, s - 2, 7);
      drawGlyph(g, type, s / 2, s / 2, color);
      g.generateTexture(key, s, s);
    }
  }

  for (const type of CONTAINER_TYPES) {
    for (const opened of [false, true]) {
      const key = crateTexture(type, opened);
      if (scene.textures.exists(key)) continue;
      const s = CRATE_TEX_SIZE;
      const color = PALETTE.crate[type];
      g.clear();
      g.fillStyle(0x000000, 0.35);
      g.fillRoundedRect(3, 5, s - 4, s - 4, 6);
      g.fillStyle(opened ? Phaser.Display.Color.IntegerToColor(color).darken(45).color : color, 1);
      g.fillRoundedRect(1, 1, s - 4, s - 4, 6);
      g.lineStyle(2, 0x000000, 0.45);
      g.strokeRoundedRect(1, 1, s - 4, s - 4, 6);
      if (opened) {
        g.fillStyle(0x05070a, 0.85);
        g.fillRoundedRect(8, 8, s - 18, s - 18, 3);
      } else {
        g.lineStyle(3, 0x000000, 0.28);
        g.lineBetween(4, s / 2 - 2, s - 7, s / 2 - 2);
        g.lineBetween(s / 2 - 2, 4, s / 2 - 2, s - 7);
        if (type === 'SUPPLY_DROP' || type === 'LEGENDARY') {
          g.lineStyle(2, 0xffffff, 0.55);
          g.strokeRoundedRect(5, 5, s - 12, s - 12, 4);
        }
      }
      g.generateTexture(key, s, s);
    }
  }

  if (!scene.textures.exists('grid')) {
    g.clear();
    g.lineStyle(1, PALETTE.grid, 0.035);
    g.strokeRect(0, 0, 80, 80);
    g.generateTexture('grid', 80, 80);
  }

  if (!scene.textures.exists('lock')) {
    g.clear();
    g.fillStyle(0xf59e0b, 1);
    g.fillRoundedRect(2, 8, 14, 11, 2);
    g.lineStyle(3, 0xf59e0b, 1);
    g.strokeCircle(9, 8, 5);
    g.generateTexture('lock', 18, 20);
  }
  g.destroy();
}
