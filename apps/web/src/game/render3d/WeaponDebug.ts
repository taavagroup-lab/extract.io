import { PLAYER_CONFIG } from '@extract/game-config';
import * as THREE from 'three';
import { weaponDebugFlags } from '../../lib/devFlags';
import type { GameClient } from '../net/GameClient';
import type { CharacterModel } from './models/CharacterModel';
import { GUN_HEIGHT } from './style';

const MAX_SEGMENTS = 1200;
const CIRCLE_STEPS = 24;

/**
 * DEV overlay for tuning weapons: hitboxes, projectile paths, the spread
 * cone, muzzle / ejection anchors and a live stats readout. Costs nothing
 * while every flag is off (production never enables it).
 */
export class WeaponDebug {
  private readonly lines: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly marker: THREE.Mesh;
  private readonly ejectMarker: THREE.Mesh;
  private readonly panel: HTMLPreElement;
  private n = 0;
  private lastText = '';
  private readonly v = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(scene: THREE.Scene, container: HTMLElement) {
    this.positions = new Float32Array(MAX_SEGMENTS * 6);
    this.colors = new Float32Array(MAX_SEGMENTS * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, toneMapped: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 50;
    const dot = new THREE.SphereGeometry(2.4, 8, 6);
    this.marker = new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false, toneMapped: false }));
    this.ejectMarker = new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false, toneMapped: false }));
    this.marker.renderOrder = this.ejectMarker.renderOrder = 51;
    scene.add(this.lines, this.marker, this.ejectMarker);
    this.panel = document.createElement('pre');
    this.panel.className = 'weapon-debug';
    container.appendChild(this.panel);
    this.setVisible(false);
  }

  private setVisible(on: boolean): void {
    this.lines.visible = on;
    this.marker.visible = on;
    this.ejectMarker.visible = on;
  }

  private seg(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): void {
    if (this.n >= MAX_SEGMENTS) return;
    const o = this.n * 6;
    this.positions.set([x0, y0, z0, x1, y1, z1], o);
    this.c.setHex(color);
    this.colors.set([this.c.r, this.c.g, this.c.b, this.c.r, this.c.g, this.c.b], o);
    this.n++;
  }

  private circle(x: number, z: number, r: number, color: number): void {
    for (let i = 0; i < CIRCLE_STEPS; i++) {
      const a0 = (i / CIRCLE_STEPS) * Math.PI * 2;
      const a1 = ((i + 1) / CIRCLE_STEPS) * Math.PI * 2;
      this.seg(x + Math.cos(a0) * r, GUN_HEIGHT, z + Math.sin(a0) * r, x + Math.cos(a1) * r, GUN_HEIGHT, z + Math.sin(a1) * r, color);
    }
  }

  update(client: GameClient, self: CharacterModel | null, _camera: THREE.Camera, aim: number): void {
    const f = weaponDebugFlags.get();
    const any = f.hitboxes || f.paths || f.spread || f.muzzle;
    this.panel.style.display = f.stats ? '' : 'none';
    if (f.stats) this.updateStats(client);
    if (!any) {
      if (this.lines.visible) this.setVisible(false);
      return;
    }
    this.setVisible(true);
    this.n = 0;
    const x = client.renderX;
    const z = client.renderY;
    if (f.hitboxes) {
      for (const p of client.players.values()) this.circle(p.x, p.y, PLAYER_CONFIG.radius, 0xff4d5e);
      this.circle(x, z, PLAYER_CONFIG.radius, 0x4ade80);
    }
    if (f.paths) {
      for (const b of client.bullets) {
        const end = b.endDist ?? b.maxDist;
        const color = b.local ? 0x4ade80 : b.ghost ? 0x38bdf8 : 0xff4d5e;
        this.seg(b.x0, GUN_HEIGHT, b.y0, b.x0 + b.dx * end, GUN_HEIGHT, b.y0 + b.dy * end, color);
      }
    }
    const def = client.activeDef;
    if (f.spread && def) {
      const spread = client.currentSpread();
      const r = def.range;
      for (const a of [aim - spread, aim + spread]) this.seg(x, GUN_HEIGHT, z, x + Math.cos(a) * r, GUN_HEIGHT, z + Math.sin(a) * r, 0xfacc15);
      this.seg(x, GUN_HEIGHT, z, x + Math.cos(aim) * r, GUN_HEIGHT, z + Math.sin(aim) * r, 0x666666);
      // Falloff start / end arcs.
      for (const [d, color] of [
        [def.falloff.startRange, 0x22c55e],
        [def.falloff.endRange, 0xef4444],
      ] as const) {
        this.seg(x + Math.cos(aim - spread) * d, GUN_HEIGHT, z + Math.sin(aim - spread) * d, x + Math.cos(aim + spread) * d, GUN_HEIGHT, z + Math.sin(aim + spread) * d, color);
      }
    }
    this.marker.visible = this.ejectMarker.visible = f.muzzle && !!self;
    if (f.muzzle && self) {
      self.muzzleWorld(this.marker.position);
      self.ejectWorld(this.ejectMarker.position);
      if (def) {
        // Where tracers start (config) vs. the model's muzzle.
        const d = def.visual.muzzleDistance;
        this.v.set(x + Math.cos(aim) * d, GUN_HEIGHT, z + Math.sin(aim) * d);
        this.seg(this.v.x - 4, GUN_HEIGHT, this.v.z, this.v.x + 4, GUN_HEIGHT, this.v.z, 0xff00ff);
        this.seg(this.v.x, GUN_HEIGHT, this.v.z - 4, this.v.x, GUN_HEIGHT, this.v.z + 4, 0xff00ff);
      }
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, this.n * 2);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateStats(client: GameClient): void {
    const def = client.activeDef;
    const rt = client.weaponRt;
    let text = 'no weapon';
    if (def) {
      const deg = (r: number) => ((r * 180) / Math.PI).toFixed(2);
      const ttk = Math.ceil(100 / (def.damage * def.pelletCount));
      text = [
        `${def.name} · ${def.displayName} · ${def.fireMode} · ${def.rarity}`,
        `dmg ${def.damage}${def.pelletCount > 1 ? `×${def.pelletCount}` : ''}  armor×${def.armorDamageMultiplier}  pierce ${def.pierce}  hits-to-kill ${ttk}`,
        `rpm ${def.fireRate}  mag ${client.displayMag()}/${def.magazineSize} ${def.ammoType}  reload ${def.reloadMs}/${def.tacticalReloadMs}${def.reloadStyle === 'SHELL' ? ` +${def.shellReloadMs}/shell` : ''}  equip ${def.equipMs}`,
        `speed ${def.projectileSpeed}  range ${def.range}  falloff ${def.falloff.startRange}-${def.falloff.endRange} → ×${def.falloff.minMultiplier}`,
        `spread ${deg(client.currentSpread())}°  (stand ${deg(def.spreadStanding)} move ${deg(def.spreadMoving)} bloom ${deg(rt.bloom)}/${deg(def.spreadMax)})`,
        `phase ${client.currentWeaponPhase()}  cooldown ${rt.cooldownMs.toFixed(0)}ms  streak ${rt.streak}  motion ${rt.motion.toFixed(2)}  move×${def.movementSpeedMultiplier}`,
      ].join('\n');
    }
    if (text !== this.lastText) {
      this.lastText = text;
      this.panel.textContent = text;
    }
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.marker.geometry.dispose();
    this.lines.removeFromParent();
    this.marker.removeFromParent();
    this.ejectMarker.removeFromParent();
    this.panel.remove();
  }
}
