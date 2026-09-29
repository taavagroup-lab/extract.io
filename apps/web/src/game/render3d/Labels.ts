import * as THREE from 'three';

interface PlayerLabel {
  el: HTMLDivElement;
  hp: HTMLElement;
  armor: HTMLElement;
  tag: HTMLElement;
  lastKey: string;
}

interface DamageLabel {
  el: HTMLDivElement;
  x: number;
  z: number;
  born: number;
  active: boolean;
  target: number;
  total: number;
}

const DAMAGE_POOL = 28;
const DAMAGE_MS = 750;
/** Hits on the same target within this window merge into one number. */
const MERGE_MS = 450;

/**
 * Screen-space DOM labels anchored to world positions (crisp text, CSS
 * styling): player names + health bars, damage numbers, zone captions.
 */
export class Labels {
  readonly el: HTMLDivElement;
  private readonly players = new Map<number, PlayerLabel>();
  private readonly damage: DamageLabel[] = [];
  private cursor = 0;
  private readonly zones = new Map<string, HTMLDivElement>();
  private readonly v = new THREE.Vector3();
  private width = 1;
  private height = 1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'world-labels';
    parent.appendChild(this.el);
    for (let i = 0; i < DAMAGE_POOL; i++) {
      const el = document.createElement('div');
      el.className = 'lbl-dmg';
      el.style.display = 'none';
      this.el.appendChild(el);
      this.damage.push({ el, x: 0, z: 0, born: 0, active: false, target: -1, total: 0 });
    }
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }

  /** World -> CSS pixel position; null when behind the camera / off screen. */
  private project(camera: THREE.Camera, x: number, y: number, z: number): [number, number] | null {
    this.v.set(x, y, z).project(camera);
    if (this.v.z > 1 || this.v.x < -1.2 || this.v.x > 1.2 || this.v.y < -1.2 || this.v.y > 1.2) return null;
    return [((this.v.x + 1) / 2) * this.width, ((1 - this.v.y) / 2) * this.height];
  }

  private place(el: HTMLElement, pos: [number, number] | null): void {
    if (!pos) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.transform = `translate3d(${pos[0].toFixed(1)}px, ${pos[1].toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  updatePlayer(camera: THREE.Camera, id: number, name: string, bot: boolean, x: number, z: number, hp: number, maxHp: number, armor: number, tag: string | null): void {
    let l = this.players.get(id);
    if (!l) {
      const el = document.createElement('div');
      el.className = `lbl-player${bot ? ' is-bot' : ''}`;
      el.innerHTML = '<span class="lbl-tag"></span><span class="lbl-name"></span><span class="lbl-bars"><i class="lbl-hp"></i><i class="lbl-armor"></i></span>';
      (el.querySelector('.lbl-name') as HTMLElement).textContent = name;
      this.el.appendChild(el);
      l = { el, hp: el.querySelector('.lbl-hp')!, armor: el.querySelector('.lbl-armor')!, tag: el.querySelector('.lbl-tag')!, lastKey: '' };
      this.players.set(id, l);
    }
    const key = `${hp}|${armor}|${tag ?? ''}`;
    if (key !== l.lastKey) {
      l.lastKey = key;
      const pct = Math.max(0, Math.min(1, hp / maxHp));
      l.hp.style.width = `${pct * 100}%`;
      l.hp.classList.toggle('is-low', pct < 0.35);
      l.armor.style.width = `${Math.min(100, armor)}%`;
      l.tag.textContent = tag ?? '';
      l.tag.style.display = tag ? '' : 'none';
      l.tag.classList.toggle('is-kingpin', tag === 'KINGPIN');
    }
    this.place(l.el, this.project(camera, x, 64, z));
  }

  retainPlayers(ids: Set<number>): void {
    for (const [id, l] of this.players) {
      if (!ids.has(id)) {
        l.el.remove();
        this.players.delete(id);
      }
    }
  }

  /**
   * Damage number over a target. Rapid hits on the same target add up into
   * one number (no number spam from SMGs / shotgun pellets).
   */
  showDamage(target: number, x: number, z: number, amount: number, armor: boolean): void {
    const now = performance.now();
    let d = this.damage.find((l) => l.active && l.target === target && now - l.born < MERGE_MS);
    if (d) d.total += amount;
    else {
      d = this.damage[this.cursor++ % DAMAGE_POOL]!;
      d.total = amount;
      d.target = target;
      d.x = x + (Math.random() - 0.5) * 16;
    }
    d.z = z;
    d.born = now;
    d.active = true;
    d.el.textContent = String(d.total);
    d.el.classList.toggle('is-armor', armor);
    d.el.classList.toggle('is-big', d.total >= 40);
    d.el.classList.remove('is-pop');
    void d.el.offsetWidth;
    d.el.classList.add('is-pop');
  }

  updateZone(camera: THREE.Camera, id: string, text: string | null, x: number, z: number, radius: number, cls: string): void {
    let el = this.zones.get(id);
    if (!el) {
      el = document.createElement('div');
      this.el.appendChild(el);
      this.zones.set(id, el);
    }
    el.className = `lbl-zone ${cls}`;
    if (!text) {
      el.style.display = 'none';
      return;
    }
    if (el.textContent !== text) el.textContent = text;
    this.place(el, this.project(camera, x, 40, z - radius - 10));
  }

  updateDamage(camera: THREE.Camera): void {
    const now = performance.now();
    for (const d of this.damage) {
      if (!d.active) continue;
      const t = (now - d.born) / DAMAGE_MS;
      if (t >= 1) {
        d.active = false;
        d.el.style.display = 'none';
        continue;
      }
      const pos = this.project(camera, d.x, 50 + t * 55, d.z);
      this.place(d.el, pos);
      d.el.style.opacity = String(1 - t * t);
    }
  }

  dispose(): void {
    this.el.remove();
    this.players.clear();
    this.zones.clear();
  }
}
