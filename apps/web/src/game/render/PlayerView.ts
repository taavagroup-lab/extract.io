import { PLAYER_CONFIG, weaponFromIndex } from '@extract/game-config';
import { PLAYER_FLAGS } from '@extract/game-types';
import Phaser from 'phaser';
import { PALETTE } from './palette';

const R = PLAYER_CONFIG.radius;

/** Visual for one character: body circle, weapon, name, health bar and status rings. */
export class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly gun: Phaser.GameObjects.Graphics;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text | null;
  private weapon = -2;
  private hpKey = '';
  private flags = -1;

  constructor(
    scene: Phaser.Scene,
    name: string,
    private readonly color: number,
    private readonly isSelf: boolean,
  ) {
    this.ring = scene.add.graphics();
    this.gun = scene.add.graphics();
    this.body = scene.add.graphics();
    this.hpBar = scene.add.graphics();
    this.body.fillStyle(0x000000, 0.3);
    this.body.fillCircle(3, 5, R);
    this.body.fillStyle(color, 1);
    this.body.fillCircle(0, 0, R);
    this.body.lineStyle(3, PALETTE.outline, 0.85);
    this.body.strokeCircle(0, 0, R);
    this.body.fillStyle(0xffffff, 0.18);
    this.body.fillCircle(-6, -7, 8);
    const children: Phaser.GameObjects.GameObject[] = [this.ring, this.gun, this.body, this.hpBar];
    if (!isSelf) {
      this.label = scene.add
        .text(0, -R - 26, name, { fontFamily: 'Inter, sans-serif', fontSize: '13px', fontStyle: '600', color: '#e7ebf2' })
        .setOrigin(0.5, 1)
        .setAlpha(0.9);
      children.push(this.label);
    } else {
      this.label = null;
    }
    this.container = scene.add.container(0, 0, children).setDepth(10);
  }

  update(x: number, y: number, rot: number, weapon: number, hp: number, maxHp: number, armor: number, flags: number, time: number): void {
    this.container.setPosition(x, y);
    this.gun.setRotation(rot);
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      const def = weaponFromIndex(weapon);
      this.gun.clear();
      if (def) {
        const len = def.barrelLength;
        const thick = def.id === 'shotgun' ? 10 : def.id === 'assault_rifle' ? 8 : 7;
        this.gun.fillStyle(0x1f2937, 1);
        this.gun.fillRoundedRect(R - 8, -thick / 2, len, thick, 2);
        this.gun.lineStyle(2, 0x000000, 0.5);
        this.gun.strokeRoundedRect(R - 8, -thick / 2, len, thick, 2);
      }
      this.gun.fillStyle(this.color, 1);
      this.gun.fillCircle(R - 4, 8, 6);
      this.gun.fillCircle(R - 2, -8, 6);
      this.gun.lineStyle(2, PALETTE.outline, 0.8);
      this.gun.strokeCircle(R - 4, 8, 6);
      this.gun.strokeCircle(R - 2, -8, 6);
    }
    if (!this.isSelf) {
      const key = `${hp}|${maxHp}|${armor}`;
      if (key !== this.hpKey) {
        this.hpKey = key;
        const w = 48;
        this.hpBar.clear();
        this.hpBar.fillStyle(0x000000, 0.6);
        this.hpBar.fillRect(-w / 2, -R - 16, w, 6);
        this.hpBar.fillStyle(hp / maxHp > 0.35 ? 0x4ade80 : 0xef4444, 1);
        this.hpBar.fillRect(-w / 2, -R - 16, (w * Math.max(0, hp)) / maxHp, 6);
        if (armor > 0) {
          this.hpBar.fillStyle(0x38bdf8, 1);
          this.hpBar.fillRect(-w / 2, -R - 10, (w * Math.min(100, armor)) / 100, 2);
        }
      }
    }
    if (flags !== this.flags || flags & (PLAYER_FLAGS.BOUNTY | PLAYER_FLAGS.EXTRACTING)) {
      this.flags = flags;
      this.ring.clear();
      const pulse = 0.5 + 0.5 * Math.sin(time / 180);
      if (flags & PLAYER_FLAGS.BOUNTY) {
        this.ring.lineStyle(3, PALETTE.danger, 0.5 + 0.4 * pulse);
        this.ring.strokeCircle(0, 0, R + 9 + pulse * 3);
      }
      if (flags & PLAYER_FLAGS.EXTRACTING) {
        this.ring.lineStyle(3, PALETTE.extraction, 0.6 + 0.3 * pulse);
        this.ring.strokeCircle(0, 0, R + 5);
      }
      this.container.setAlpha(flags & PLAYER_FLAGS.DISCONNECTED ? 0.45 : 1);
    }
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
