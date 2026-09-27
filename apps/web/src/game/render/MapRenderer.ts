import type { MapData } from '@extract/game-types';
import Phaser from 'phaser';
import { PALETTE } from './palette';

/** Draws the static map once (zones, floors, obstacles, labels). */
export function drawStaticMap(scene: Phaser.Scene, map: MapData): void {
  const ground = scene.add.graphics().setDepth(0);
  ground.fillStyle(PALETTE.ground, 1);
  ground.fillRect(0, 0, map.width, map.height);
  for (const z of map.zones) {
    ground.fillStyle(PALETTE.zone[z.type], 1);
    ground.fillRect(z.x, z.y, z.w, z.h);
  }
  for (const f of map.floors) {
    ground.fillStyle(PALETTE.floor[f.style], 1);
    ground.fillRect(f.x, f.y, f.w, f.h);
  }
  // Road center dashes.
  ground.fillStyle(0xe5e7eb, 0.08);
  for (const f of map.floors) {
    if (f.style !== 'road') continue;
    const horizontal = f.w > f.h;
    const len = horizontal ? f.w : f.h;
    for (let d = 0; d < len; d += 90) {
      if (horizontal) ground.fillRect(f.x + d, f.y + f.h / 2 - 2, 45, 4);
      else ground.fillRect(f.x + f.w / 2 - 2, f.y + d, 4, 45);
    }
  }

  scene.add.tileSprite(0, 0, map.width, map.height, 'grid').setOrigin(0).setDepth(1);

  // Zone outlines + faint labels.
  const outline = scene.add.graphics().setDepth(2);
  for (const z of map.zones) {
    const color = z.type === 'HIGH_VALUE' ? PALETTE.warning : 0xffffff;
    outline.lineStyle(z.type === 'HIGH_VALUE' ? 3 : 2, color, z.type === 'HIGH_VALUE' ? 0.35 : 0.05);
    outline.strokeRect(z.x, z.y, z.w, z.h);
    scene.add
      .text(z.x + z.w / 2, z.y + z.h / 2, z.name.toUpperCase(), {
        fontFamily: 'Chakra Petch, sans-serif',
        fontSize: z.w > 1000 ? '140px' : '64px',
        fontStyle: '700',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setAlpha(0.045)
      .setDepth(2);
  }

  const obstacles = scene.add.graphics().setDepth(8);
  const shadows = scene.add.graphics().setDepth(7);
  shadows.fillStyle(0x000000, 0.28);
  for (const o of map.obstacles) {
    if (o.kind === 'rect') {
      shadows.fillRect(o.x + 5, o.y + 7, o.w, o.h);
      const color = o.style === 'container' ? PALETTE.containerTints[(o.tint ?? 0) % PALETTE.containerTints.length]! : PALETTE.obstacle[o.style];
      obstacles.fillStyle(color, 1);
      obstacles.fillRect(o.x, o.y, o.w, o.h);
      obstacles.lineStyle(2, 0x000000, 0.35);
      obstacles.strokeRect(o.x, o.y, o.w, o.h);
      if (o.style === 'container') {
        obstacles.lineStyle(2, 0x000000, 0.18);
        const vertical = o.h > o.w;
        const len = vertical ? o.h : o.w;
        for (let d = 14; d < len - 6; d += 14) {
          if (vertical) obstacles.lineBetween(o.x + 4, o.y + d, o.x + o.w - 4, o.y + d);
          else obstacles.lineBetween(o.x + d, o.y + 4, o.x + d, o.y + o.h - 4);
        }
      } else if (o.style === 'wall' || o.style === 'vault') {
        obstacles.fillStyle(0xffffff, 0.06);
        obstacles.fillRect(o.x, o.y, o.w, Math.min(4, o.h));
      }
    } else {
      shadows.fillCircle(o.x + 5, o.y + 7, o.r);
      if (o.style === 'tree') {
        obstacles.fillStyle(0x173d24, 1);
        obstacles.fillCircle(o.x, o.y, o.r);
        obstacles.fillStyle(PALETTE.obstacle.tree, 1);
        obstacles.fillCircle(o.x - o.r * 0.12, o.y - o.r * 0.12, o.r * 0.8);
        obstacles.fillStyle(0x2c6b40, 1);
        obstacles.fillCircle(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.35);
      } else {
        obstacles.fillStyle(PALETTE.obstacle[o.style], 1);
        obstacles.fillCircle(o.x, o.y, o.r);
        obstacles.fillStyle(0xffffff, 0.08);
        obstacles.fillCircle(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.45);
      }
    }
  }
}
