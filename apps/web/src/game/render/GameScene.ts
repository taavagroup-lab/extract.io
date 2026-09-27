import { NETWORK_CONFIG, RARITY_CONFIG, getItemDef, weaponFromIndex, weaponIndex } from '@extract/game-config';
import type { CrateView, GroundItemView } from '@extract/game-types';
import { formatClock } from '@extract/shared';
import Phaser from 'phaser';
import type { InputController } from '../input/InputController';
import { GameClient } from '../net/GameClient';
import { drawStaticMap } from './MapRenderer';
import { PALETTE } from './palette';
import { PlayerView } from './PlayerView';
import { CRATE_TEX_SIZE, crateTexture, generateTextures, itemTexture } from './textures';

interface Spark {
  x: number;
  y: number;
  born: number;
  life: number;
  r: number;
  color: number;
}

const MAX_DAMAGE_TEXTS = 24;
const BULLET_TAIL = 28;

/** Renders the client state. Contains no game rules. */
export class GameScene extends Phaser.Scene {
  private selfView: PlayerView | null = null;
  private readonly playerViews = new Map<number, PlayerView>();
  private readonly itemViews = new Map<number, Phaser.GameObjects.Image>();
  private readonly crateViews = new Map<number, { img: Phaser.GameObjects.Image; lock: Phaser.GameObjects.Image | null; key: string }>();
  private dynamic!: Phaser.GameObjects.Graphics;
  private bulletsGfx!: Phaser.GameObjects.Graphics;
  private zoneLabels = new Map<string, Phaser.GameObjects.Text>();
  private supplyLabels = new Map<number, Phaser.GameObjects.Text>();
  private readonly sparks: Spark[] = [];
  private damageTexts: Phaser.GameObjects.Text[] = [];
  private damageCursor = 0;
  private readonly seenBullets = new Set<number>();
  private mapDrawn = false;

  constructor(
    private readonly client: GameClient,
    private readonly controls: InputController,
  ) {
    super('game');
  }

  create(): void {
    generateTextures(this);
    this.cameras.main.setBackgroundColor(PALETTE.background);
    this.dynamic = this.add.graphics().setDepth(4);
    this.bulletsGfx = this.add.graphics().setDepth(12);
    for (let i = 0; i < MAX_DAMAGE_TEXTS; i++) {
      this.damageTexts.push(
        this.add
          .text(0, 0, '', { fontFamily: 'JetBrains Mono, monospace', fontSize: '18px', fontStyle: '700', color: '#fde047', stroke: '#000', strokeThickness: 4 })
          .setOrigin(0.5)
          .setDepth(30)
          .setVisible(false),
      );
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.controls.mouseDown = true;
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) this.controls.mouseDown = false;
    });
    this.scale.on('resize', () => this.fitCamera());
    this.fitCamera();
  }

  private fitCamera(): void {
    const { width, height } = this.scale.gameSize;
    const zoom = Math.max(width / NETWORK_CONFIG.view.width, height / NETWORK_CONFIG.view.height);
    this.cameras.main.setZoom(zoom);
  }

  override update(time: number, delta: number): void {
    const c = this.client;
    if (!this.mapDrawn && c.map) {
      drawStaticMap(this, c.map);
      this.cameras.main.setBounds(-200, -200, c.map.width + 400, c.map.height + 400);
      this.mapDrawn = true;
    }

    const cam = this.cameras.main;
    const pointer = this.input.activePointer;
    const world = cam.getWorldPoint(pointer.x, pointer.y);
    const aim = Math.atan2(world.y - c.renderY, world.x - c.renderX);
    c.update(delta, this.controls.sample(aim));

    this.syncSelf(time, aim);
    this.syncPlayers(time);
    this.syncItems(time);
    this.syncCrates();
    this.drawDynamic(time);
    this.drawBullets();
    this.drainFx();
    this.drawSparks();

    if (c.predictionReady) cam.centerOn(c.renderX, c.renderY);
  }

  private syncSelf(time: number, aim: number): void {
    const c = this.client;
    const s = c.self;
    if (!s || !c.predictionReady) return;
    this.selfView ??= new PlayerView(this, c.playerName, PALETTE.self, true);
    const alive = s.status === 'ALIVE' || s.status === 'EXTRACTING';
    this.selfView.container.setVisible(alive);
    const weapon = s.weapons[s.activeSlot];
    const flags = (s.bountyCents > 0 ? 1 : 0) | (s.status === 'EXTRACTING' ? 2 : 0);
    this.selfView.update(c.renderX, c.renderY, aim, weaponIndex(weapon?.weaponId), s.hp, s.maxHp, s.armor, flags, time);
  }

  private syncPlayers(time: number): void {
    const c = this.client;
    for (const [id, view] of this.playerViews) {
      if (!c.players.has(id)) {
        view.destroy();
        this.playerViews.delete(id);
      }
    }
    for (const p of c.players.values()) {
      let view = this.playerViews.get(p.id);
      if (!view) {
        view = new PlayerView(this, p.name, p.bot ? PALETTE.bot : PALETTE.human, false);
        this.playerViews.set(p.id, view);
      }
      view.update(p.x, p.y, p.rot, p.weapon, p.hp, p.maxHp, p.armor, p.flags, time);
    }
  }

  private syncItems(time: number): void {
    const c = this.client;
    for (const [id, img] of this.itemViews) {
      if (!c.items.has(id)) {
        img.destroy();
        this.itemViews.delete(id);
      }
    }
    for (const it of c.items.values()) {
      let img = this.itemViews.get(it.id);
      if (!img) {
        img = this.createItem(it);
        this.itemViews.set(it.id, img);
      }
      const def = getItemDef(it.itemId);
      if (RARITY_CONFIG[def.rarity].rank >= 3) img.setScale(1 + 0.08 * Math.sin(time / 200 + it.id));
    }
  }

  private createItem(it: GroundItemView): Phaser.GameObjects.Image {
    const def = getItemDef(it.itemId);
    return this.add.image(it.x, it.y, itemTexture(def.type, def.rarity)).setDepth(5);
  }

  private syncCrates(): void {
    const c = this.client;
    for (const [id, v] of this.crateViews) {
      if (!c.crates.has(id)) {
        v.img.destroy();
        v.lock?.destroy();
        this.crateViews.delete(id);
      }
    }
    for (const crate of c.crates.values()) {
      const key = crateTexture(crate.type, crate.opened);
      const v = this.crateViews.get(crate.id);
      if (!v) {
        this.crateViews.set(crate.id, this.createCrate(crate, key));
      } else if (v.key !== key || (v.lock !== null) !== (crate.locked && !crate.opened)) {
        v.img.setTexture(key);
        v.key = key;
        if (!(crate.locked && !crate.opened)) {
          v.lock?.destroy();
          v.lock = null;
        }
      }
    }
  }

  private createCrate(crate: CrateView, key: string) {
    const img = this.add.image(crate.x, crate.y, key).setDepth(4.5);
    const lock = crate.locked && !crate.opened ? this.add.image(crate.x + CRATE_TEX_SIZE / 2 - 6, crate.y - CRATE_TEX_SIZE / 2 + 4, 'lock').setDepth(4.6) : null;
    return { img, lock, key };
  }

  private drawDynamic(time: number): void {
    const g = this.dynamic;
    const c = this.client;
    g.clear();
    const global = c.global;
    if (!global) return;
    const pulse = 0.5 + 0.5 * Math.sin(time / 260);

    for (const z of global.extractionZones) {
      const { x, y } = z.position;
      if (z.active) {
        g.fillStyle(PALETTE.extraction, 0.07 + 0.05 * pulse);
        g.fillCircle(x, y, z.radius);
        g.lineStyle(4, PALETTE.extraction, 0.55 + 0.35 * pulse);
        g.strokeCircle(x, y, z.radius);
        g.lineStyle(2, PALETTE.extraction, 0.25);
        g.strokeCircle(x, y, z.radius * 0.55 + pulse * 10);
        if (z.playersCurrentlyExtracting.length > 0) {
          g.lineStyle(6, PALETTE.warning, 0.5 + 0.5 * pulse);
          g.strokeCircle(x, y, z.radius + 10);
        }
      } else {
        g.lineStyle(2, 0xffffff, 0.08);
        g.strokeCircle(x, y, z.radius);
      }
      let label = this.zoneLabels.get(z.id);
      if (!label) {
        label = this.add
          .text(x, y - z.radius - 14, '', { fontFamily: 'Chakra Petch, sans-serif', fontSize: '20px', fontStyle: '700', color: '#34d399' })
          .setOrigin(0.5, 1)
          .setDepth(20);
        this.zoneLabels.set(z.id, label);
      }
      label.setText(z.active ? `EXTRACT · ${z.name.toUpperCase()}` : '');
    }

    // Self extraction progress ring.
    const ex = c.self?.extraction;
    if (ex && c.self) {
      g.lineStyle(7, PALETTE.extraction, 0.95);
      g.beginPath();
      g.arc(c.renderX, c.renderY, 38, -Math.PI / 2, -Math.PI / 2 + ex.progress * Math.PI * 2, false);
      g.strokePath();
    }

    for (const d of global.supplyDrops) {
      let label = this.supplyLabels.get(d.id);
      if (!label) {
        label = this.add
          .text(d.x, d.y - 70, '', { fontFamily: 'Chakra Petch, sans-serif', fontSize: '18px', fontStyle: '700', color: '#fb923c' })
          .setOrigin(0.5)
          .setDepth(20);
        this.supplyLabels.set(d.id, label);
      }
      if (!d.landed) {
        const remaining = d.landsAtMs - c.serverNow();
        g.lineStyle(3, 0xfb923c, 0.5 + 0.5 * pulse);
        g.strokeCircle(d.x, d.y, 50 + 30 * (1 - pulse));
        g.fillStyle(0xfb923c, 0.12);
        g.fillCircle(d.x, d.y, 50);
        label.setText(`SUPPLY DROP ${formatClock(Math.max(0, remaining))}`);
      } else {
        label.setText(d.opened ? '' : 'SUPPLY DROP');
        if (!d.opened) {
          g.lineStyle(2, 0xfb923c, 0.4 + 0.4 * pulse);
          g.strokeCircle(d.x, d.y, 42);
        }
      }
    }

    for (const b of global.bounties) {
      g.lineStyle(3, PALETTE.danger, 0.35 + 0.3 * pulse);
      g.strokeCircle(b.x, b.y, b.radius);
      g.fillStyle(PALETTE.danger, 0.04);
      g.fillCircle(b.x, b.y, b.radius);
    }

    if (global.highValueActive && c.map) {
      const vault = c.map.zones.find((z) => z.type === 'HIGH_VALUE');
      if (vault) {
        g.lineStyle(4, PALETTE.warning, 0.25 + 0.3 * pulse);
        g.strokeRect(vault.x - 6, vault.y - 6, vault.w + 12, vault.h + 12);
      }
    }
  }

  private drawBullets(): void {
    const g = this.bulletsGfx;
    const c = this.client;
    const now = performance.now();
    g.clear();
    for (let i = c.bullets.length - 1; i >= 0; i--) {
      const b = c.bullets[i]!;
      const end = b.endDist ?? b.maxDist;
      const dist = ((now - b.born) / 1000) * b.speed + 24;
      if (!this.seenBullets.has(b.id)) {
        this.seenBullets.add(b.id);
        this.sparks.push({ x: b.x0 + b.dx * 44, y: b.y0 + b.dy * 44, born: now, life: 70, r: 9, color: 0xfff3b0 });
      }
      if (dist >= end) {
        const hx = b.x0 + b.dx * end;
        const hy = b.y0 + b.dy * end;
        this.sparks.push({ x: hx, y: hy, born: now, life: b.hitPlayer ? 180 : 120, r: b.hitPlayer ? 10 : 5, color: b.hitPlayer ? 0xef4444 : 0xd1d5db });
        c.bullets.splice(i, 1);
        this.seenBullets.delete(b.id);
        continue;
      }
      const head = Math.min(dist, end);
      const tail = Math.max(24, head - BULLET_TAIL);
      const color = weaponFromIndex(b.weapon)?.bulletColor ?? 0xffffff;
      g.lineStyle(3, color, 0.95);
      g.lineBetween(b.x0 + b.dx * tail, b.y0 + b.dy * tail, b.x0 + b.dx * head, b.y0 + b.dy * head);
    }
    if (this.seenBullets.size > 2000) this.seenBullets.clear();
  }

  private drainFx(): void {
    const c = this.client;
    while (c.fx.length > 0) {
      const ev = c.fx.shift()!;
      if (ev.e === 'dmg') {
        const t = this.damageTexts[this.damageCursor++ % MAX_DAMAGE_TEXTS]!;
        this.tweens.killTweensOf(t);
        t.setText(String(ev.amount))
          .setColor(ev.armor ? '#7dd3fc' : '#fde047')
          .setPosition(ev.x + Phaser.Math.Between(-12, 12), ev.y - 30)
          .setAlpha(1)
          .setVisible(true);
        this.tweens.add({ targets: t, y: t.y - 42, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => t.setVisible(false) });
      } else if (ev.e === 'hurt') {
        this.cameras.main.shake(110, 0.004);
      }
    }
  }

  private drawSparks(): void {
    const now = performance.now();
    const g = this.bulletsGfx;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      const t = (now - s.born) / s.life;
      if (t >= 1) {
        this.sparks.splice(i, 1);
        continue;
      }
      g.fillStyle(s.color, 1 - t);
      g.fillCircle(s.x, s.y, s.r * (1 + t));
    }
    if (this.sparks.length > 200) this.sparks.splice(0, this.sparks.length - 200);
  }
}
