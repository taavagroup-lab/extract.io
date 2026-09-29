import type { MuzzleFlashType } from '@extract/game-types';
import * as THREE from 'three';
import { Textures } from '../textures';

interface FlashStyle {
  /** Forward flame length / width (model units). */
  len: number;
  width: number;
  /** Star core size. */
  core: number;
  /** Sideways flames (muzzle brakes), 0 = none. */
  side: number;
  color: number;
  /** HDR multiplier (only > 1 blooms). */
  intensity: number;
  /** Visible time. */
  ms: number;
}

/** Per weapon family: small and quick for pistols / SMGs, big and slow for shotguns and the sniper. */
const STYLE: Record<MuzzleFlashType, FlashStyle> = {
  pistol: { len: 13, width: 8, core: 15, side: 0, color: 0xffc27a, intensity: 3.2, ms: 42 },
  magnum: { len: 22, width: 15, core: 28, side: 9, color: 0xffb262, intensity: 4.2, ms: 60 },
  smg: { len: 11, width: 7, core: 13, side: 0, color: 0xffc98a, intensity: 3, ms: 30 },
  suppressed: { len: 4, width: 4, core: 6, side: 0, color: 0xffe0b8, intensity: 1.5, ms: 26 },
  rifle: { len: 19, width: 10, core: 20, side: 6, color: 0xffbd72, intensity: 3.6, ms: 40 },
  battle: { len: 25, width: 15, core: 28, side: 13, color: 0xffac58, intensity: 4.2, ms: 55 },
  shotgun: { len: 34, width: 24, core: 38, side: 7, color: 0xffa24a, intensity: 4.6, ms: 68 },
  sniper: { len: 28, width: 13, core: 32, side: 22, color: 0xffc680, intensity: 4.8, ms: 62 },
  lmg: { len: 21, width: 11, core: 22, side: 5, color: 0xffb468, intensity: 3.6, ms: 38 },
  void: { len: 17, width: 12, core: 24, side: 11, color: 0xb57bff, intensity: 4.4, ms: 55 },
};

/** Flame quad with its base at the local origin, pointing +X. */
const petalGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);

/**
 * Muzzle flash attached to a weapon's muzzle: a bright star core (always
 * faces the camera) plus crossed flame petals along the barrel and, for
 * braked muzzles, sideways jets. Randomised every shot, visible for only
 * a couple of frames.
 */
export class MuzzleFlash {
  readonly group = new THREE.Group();
  private readonly core: THREE.Sprite;
  private readonly petalMat: THREE.MeshBasicMaterial;
  private readonly flat: THREE.Mesh;
  private readonly upright: THREE.Mesh;
  private readonly sides: THREE.Mesh[] = [];
  private style: FlashStyle = STYLE.rifle;
  private t = 0;

  constructor() {
    this.core = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: Textures.flash(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true }),
    );
    this.petalMat = new THREE.MeshBasicMaterial({
      map: Textures.flame(),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.flat = new THREE.Mesh(petalGeo, this.petalMat);
    this.flat.rotation.x = -Math.PI / 2;
    this.upright = new THREE.Mesh(petalGeo, this.petalMat);
    for (const dir of [1, -1]) {
      const m = new THREE.Mesh(petalGeo, this.petalMat);
      m.rotation.set(-Math.PI / 2, 0, dir * Math.PI * 0.5);
      this.sides.push(m);
    }
    this.group.add(this.core, this.flat, this.upright, ...this.sides);
    this.group.visible = false;
    this.group.renderOrder = 12;
  }

  fire(type: MuzzleFlashType): void {
    const s = STYLE[type];
    this.style = s;
    this.t = 1;
    const len = s.len * (0.75 + Math.random() * 0.5);
    this.flat.scale.set(len, s.width * (0.8 + Math.random() * 0.4), 1);
    this.upright.scale.set(len * 0.85, s.width * 0.7, 1);
    this.upright.rotation.x = (Math.random() - 0.5) * 0.8;
    for (const m of this.sides) {
      m.visible = s.side > 0;
      m.scale.set(s.side * (0.7 + Math.random() * 0.6), s.side * 0.55, 1);
    }
    const core = s.core * (0.8 + Math.random() * 0.4);
    this.core.scale.set(core, core, 1);
    this.core.material.rotation = Math.random() * Math.PI;
    this.core.position.x = s.len * 0.12;
    this.core.material.color.setHex(s.color).multiplyScalar(s.intensity * 0.8);
    this.petalMat.color.setHex(s.color).multiplyScalar(s.intensity);
    this.group.visible = true;
    this.apply();
  }

  private apply(): void {
    const k = this.t;
    this.petalMat.opacity = Math.min(1, k * 1.4);
    this.core.material.opacity = k;
    this.group.scale.setScalar(0.85 + (1 - k) * 0.3);
  }

  update(dt: number): void {
    if (this.t <= 0) return;
    this.t -= (dt * 1000) / this.style.ms;
    if (this.t <= 0) {
      this.t = 0;
      this.group.visible = false;
      return;
    }
    this.apply();
  }

  dispose(): void {
    this.core.material.dispose();
    this.petalMat.dispose();
  }
}
