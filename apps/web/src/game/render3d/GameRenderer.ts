import { NETWORK_CONFIG, weaponIndex } from '@extract/game-config';
import { PLAYER_FLAGS } from '@extract/game-types';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { InputController } from '../input/InputController';
import type { GameClient } from '../net/GameClient';
import { Effects } from './Effects';
import { Labels } from './Labels';
import { buildMap, type MapVisuals } from './MapBuilder3D';
import { fadeUniforms } from './materials';
import { CharacterModel } from './models/CharacterModel';
import { CrateModel } from './models/CrateModel';
import { GroundItemModel } from './models/ItemModels';
import { skinFor } from './skins';
import { COLORS, GUN_HEIGHT } from './style';

const FOV = 38;
const TILT = THREE.MathUtils.degToRad(15);
const SHADOW_EXTENT = 1150;
const SHADOW_MAP = 2048;

type Quality = 'high' | 'low';

/**
 * Three.js renderer for the match. Reads the GameClient every frame and
 * renders it; contains no game rules (those live on the server).
 */
export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly sun: THREE.DirectionalLight;
  private readonly effects: Effects;
  private readonly labels: Labels;
  private readonly resizeObserver: ResizeObserver;
  private map: MapVisuals | null = null;
  private self: CharacterModel | null = null;
  private readonly players = new Map<number, CharacterModel>();
  private readonly lastHp = new Map<number, number>();
  private readonly items = new Map<number, GroundItemModel>();
  private readonly crates = new Map<number, CrateModel>();
  private readonly pointer = new THREE.Vector2(0, 0);
  private hasPointer = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GUN_HEIGHT);
  private readonly aimPoint = new THREE.Vector3();
  private aim = 0;
  private readonly camTarget = new THREE.Vector3();
  private camReady = false;
  private shake = 0;
  private lastFrame = performance.now();
  private width = 1;
  private height = 1;
  private quality: Quality = 'high';
  private slowFrames = 0;
  private readonly seenIds = new Set<number>();
  /** Dev-only camera zoom (1 = gameplay distance). */
  private debugZoom = 1;

  constructor(
    private readonly container: HTMLElement,
    private readonly client: GameClient,
    private readonly controls: InputController,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-webgl';
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.scene.background = new THREE.Color(0x0b0f14);

    this.scene.add(new THREE.HemisphereLight(COLORS.sky, COLORS.groundBounce, 1.0));
    this.sun = new THREE.DirectionalLight(COLORS.sun, 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_EXTENT;
    sc.right = SHADOW_EXTENT;
    sc.top = SHADOW_EXTENT;
    sc.bottom = -SHADOW_EXTENT;
    sc.near = 50;
    sc.far = 3200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.8;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);

    this.effects = new Effects((ownerId) => this.onFire(ownerId));
    this.scene.add(this.effects.root);
    this.labels = new Labels(container);

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Threshold > 1: only HDR emissives (beams, visors, tracers) bloom, not bright surfaces.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.02);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    if (import.meta.env.DEV) {
      (window as unknown as { __extractRenderer?: unknown }).__extractRenderer = {
        info: () => ({ ...this.renderer.info.render, quality: this.quality, programs: this.renderer.info.programs?.length }),
        renderOnce: () => {
          const t0 = performance.now();
          this.frame(performance.now());
          return performance.now() - t0;
        },
        zoom: (k: number) => {
          this.debugZoom = Math.max(0.15, Math.min(1, k));
        },
      };
    }
  }

  start(): void {
    this.renderer.setAnimationLoop(this.frame);
  }

  // ------------------------------------------------------------------ input

  private readonly onPointerMove = (e: PointerEvent): void => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.hasPointer = true;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.onPointerMove(e);
    if (e.button === 0) this.controls.mouseDown = true;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.controls.mouseDown = false;
  };

  private computeAim(): number {
    if (!this.hasPointer || !this.client.predictionReady) return this.aim;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint)) {
      this.aim = Math.atan2(this.aimPoint.z - this.client.renderY, this.aimPoint.x - this.client.renderX);
    }
    return this.aim;
  }

  // ----------------------------------------------------------------- layout

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.labels.setSize(w, h);
  }

  private setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 1.75) : 1);
    this.sun.shadow.mapSize.set(q === 'high' ? SHADOW_MAP : 1024, q === 'high' ? SHADOW_MAP : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.resize();
  }

  // ------------------------------------------------------------------ frame

  private readonly frame = (time: number): void => {
    const now = performance.now();
    const frameMs = Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    const dt = frameMs / 1000;
    const c = this.client;

    if (!this.map && c.map) {
      this.map = buildMap(c.map);
      this.scene.add(this.map.root);
    }

    c.update(frameMs, this.controls.sample(this.computeAim()));
    fadeUniforms.uFadeCenter.value.set(c.renderX, 0, c.renderY);

    this.syncSelf(dt, time);
    this.syncPlayers(dt, time);
    this.syncItems(time);
    this.syncCrates(dt, time);
    this.drainFx();
    this.effects.update(c, dt, time);
    this.map?.setVaultActive(c.global?.highValueActive ?? false, time);
    this.updateZoneLabels();
    this.updateCamera(dt);
    this.labels.updateDamage(this.camera);

    if (this.quality === 'high') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    // Adaptive quality: sustained slow frames drop bloom + resolution.
    if (frameMs > 26) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.quality === 'high') this.setQuality('low');
  };

  private syncSelf(dt: number, time: number): void {
    const c = this.client;
    const s = c.self;
    if (!s || !c.predictionReady) return;
    if (!this.self) {
      this.self = new CharacterModel(skinFor(c.playerName), true);
      this.scene.add(this.self.root);
    }
    const alive = s.status === 'ALIVE' || s.status === 'EXTRACTING';
    this.self.root.visible = alive && c.status === 'playing';
    const weapon = s.weapons[s.activeSlot];
    this.self.setWeapon(weaponIndex(weapon?.weaponId));
    const flags = (s.bountyCents > 0 ? PLAYER_FLAGS.BOUNTY : 0) | (s.status === 'EXTRACTING' ? PLAYER_FLAGS.EXTRACTING : 0);
    this.self.update(c.renderX, c.renderY, this.aim, flags, dt, time);
  }

  private syncPlayers(dt: number, time: number): void {
    const c = this.client;
    this.seenIds.clear();
    for (const p of c.players.values()) {
      this.seenIds.add(p.id);
      let model = this.players.get(p.id);
      if (!model) {
        model = new CharacterModel(skinFor(p.name), false);
        this.players.set(p.id, model);
        this.scene.add(model.root);
      }
      const prevHp = this.lastHp.get(p.id);
      if (prevHp !== undefined && p.hp < prevHp) model.hit();
      this.lastHp.set(p.id, p.hp);
      model.setWeapon(p.weapon);
      model.update(p.x, p.y, p.rot, p.flags, dt, time);
      const tag = p.flags & PLAYER_FLAGS.BOUNTY ? 'HVT' : p.flags & PLAYER_FLAGS.DISCONNECTED ? 'OFFLINE' : p.flags & PLAYER_FLAGS.EXTRACTING ? 'EXTRACTING' : null;
      this.labels.updatePlayer(this.camera, p.id, p.name, p.bot, p.x, p.y, p.hp, p.maxHp, p.armor, tag);
    }
    for (const [id, model] of this.players) {
      if (!this.seenIds.has(id)) {
        model.dispose();
        this.players.delete(id);
        this.lastHp.delete(id);
      }
    }
    this.labels.retainPlayers(this.seenIds);
  }

  private syncItems(time: number): void {
    const c = this.client;
    for (const [id, m] of this.items) {
      if (!c.items.has(id)) {
        m.dispose();
        this.items.delete(id);
      }
    }
    for (const it of c.items.values()) {
      let m = this.items.get(it.id);
      if (!m) {
        m = new GroundItemModel(it.itemId, it.x, it.y);
        this.items.set(it.id, m);
        this.scene.add(m.root);
      }
      m.update(time);
    }
  }

  private syncCrates(dt: number, time: number): void {
    const c = this.client;
    for (const [id, m] of this.crates) {
      if (!c.crates.has(id)) {
        m.dispose();
        this.crates.delete(id);
      }
    }
    for (const cr of c.crates.values()) {
      let m = this.crates.get(cr.id);
      if (!m) {
        m = new CrateModel(cr.type, cr.x, cr.y, cr.opened, cr.locked);
        this.crates.set(cr.id, m);
        this.scene.add(m.root);
      }
      m.setState(cr.opened, cr.locked);
      m.update(dt, time);
    }
  }

  private onFire(ownerId: number): void {
    if (ownerId === this.client.playerId) {
      this.self?.fire();
      this.shake = Math.max(this.shake, 0.12);
    } else {
      this.players.get(ownerId)?.fire();
    }
  }

  private drainFx(): void {
    const c = this.client;
    while (c.fx.length > 0) {
      const ev = c.fx.shift()!;
      switch (ev.e) {
        case 'dmg':
          this.labels.showDamage(ev.x, ev.y, ev.amount, ev.armor);
          break;
        case 'hurt':
          this.shake = 1;
          this.self?.hit();
          break;
        case 'kill': {
          const victim = c.players.get(ev.victimId);
          if (victim) this.effects.deathBurst(victim.x, victim.y);
          else if (ev.victimId === c.playerId) this.effects.deathBurst(c.renderX, c.renderY);
          break;
        }
        default:
          break;
      }
    }
  }

  private updateZoneLabels(): void {
    const g = this.client.global;
    if (!g) return;
    for (const z of g.extractionZones) {
      const busy = z.playersCurrentlyExtracting.length > 0;
      this.labels.updateZone(this.camera, z.id, z.active ? `EXTRACT · ${z.name}` : null, z.position.x, z.position.y, z.radius, busy ? 'is-busy' : '');
    }
    for (const d of g.supplyDrops) {
      const remaining = Math.max(0, d.landsAtMs - this.client.serverNow());
      const text = d.opened ? null : d.landed ? 'SUPPLY DROP' : `SUPPLY DROP · ${Math.ceil(remaining / 1000)}s`;
      this.labels.updateZone(this.camera, `drop-${d.id}`, text, d.x, d.y, 70, 'is-supply');
    }
  }

  private updateCamera(dt: number): void {
    const c = this.client;
    const aspect = this.width / this.height;
    // Show at most the logical 1600 x 1000 view (fair: bigger screens do not see further).
    const depth = Math.min(NETWORK_CONFIG.view.height, NETWORK_CONFIG.view.width / aspect);
    const distance = (depth / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))) * this.debugZoom;

    if (c.predictionReady) {
      // Slight look-ahead towards the crosshair.
      const look = this.hasPointer ? Math.min(90, Math.hypot(this.aimPoint.x - c.renderX, this.aimPoint.z - c.renderY) * 0.12) : 0;
      const tx = c.renderX + Math.cos(this.aim) * look;
      const tz = c.renderY + Math.sin(this.aim) * look;
      if (!this.camReady) {
        this.camTarget.set(tx, 0, tz);
        this.camReady = true;
      }
      const k = 1 - Math.exp(-dt * 11);
      this.camTarget.x += (tx - this.camTarget.x) * k;
      this.camTarget.z += (tz - this.camTarget.z) * k;
    }

    this.shake = Math.max(0, this.shake - dt * 3.5);
    const sx = (Math.random() - 0.5) * this.shake * 14;
    const sz = (Math.random() - 0.5) * this.shake * 14;
    this.camera.position.set(this.camTarget.x + sx, Math.cos(TILT) * distance, this.camTarget.z + Math.sin(TILT) * distance + sz);
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z + sz);

    // Sun follows the view; snapped to shadow texels to avoid shimmering edges.
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const lx = Math.round(this.camTarget.x / texel) * texel;
    const lz = Math.round(this.camTarget.z / texel) * texel;
    this.sun.target.position.set(lx, 0, lz);
    this.sun.position.set(lx - 650, 1300, lz + 850);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.effects.dispose();
    this.labels.dispose();
    for (const m of this.players.values()) m.dispose();
    this.self?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
