import { NETWORK_CONFIG, THREAT_CONFIG, WEAPONS, weaponFromIndex, weaponIndex } from '@extract/game-config';
import { PLAYER_FLAGS, type Rarity } from '@extract/game-types';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { isTierAtLeast } from '@extract/shared';
import { settings, type QualitySetting } from '../../lib/settings';
import { sound } from '../audio/SoundEngine';
import type { InputController } from '../input/InputController';
import type { GameClient } from '../net/GameClient';
import { Effects } from './Effects';
import { GradePass } from './GradePass';
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

type QualityLevel = Exclude<QualitySetting, 'auto'>;
const LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const PRESETS: Record<QualityLevel, { dpr: number; composer: boolean; bloom: boolean; shadow: number }> = {
  low: { dpr: 0.75, composer: false, bloom: false, shadow: 1024 },
  medium: { dpr: 1, composer: true, bloom: false, shadow: 1024 },
  high: { dpr: 1.5, composer: true, bloom: true, shadow: 2048 },
  ultra: { dpr: 2, composer: true, bloom: true, shadow: 4096 },
};

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
  private readonly grade: GradePass;
  private readonly sun: THREE.DirectionalLight;
  private readonly muzzleLight = new THREE.PointLight(0xffc27a, 0, 320, 2);
  private readonly effects: Effects;
  private readonly labels: Labels;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeSettings: () => void;
  private map: MapVisuals | null = null;
  private self: CharacterModel | null = null;
  private readonly players = new Map<number, CharacterModel>();
  private readonly lastHp = new Map<number, number>();
  private readonly items = new Map<number, GroundItemModel>();
  private readonly crates = new Map<number, CrateModel>();
  private readonly seenIds = new Set<number>();

  // Input / aim
  private readonly pointer = new THREE.Vector2(0, 0);
  private hasPointer = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GUN_HEIGHT);
  private readonly aimPoint = new THREE.Vector3();
  private aim = 0;

  // Camera
  private readonly camTarget = new THREE.Vector3();
  private readonly look = new THREE.Vector2();
  private shake = 0;

  // DOM overlays
  private readonly crosshair: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  private spread = 0;

  // Timing / quality
  private lastFrame = performance.now();
  private width = 1;
  private height = 1;
  private level: QualityLevel = 'high';
  private frameEma = 16.7;
  private lastQualityCheck = performance.now();
  private goodChecks = 0;
  private badChecks = 0;
  private fpsFrames = 0;
  private fpsLastAt = performance.now();
  private debugZoom = 1;

  // Audio / feel bookkeeping
  private lastReloadMs = 0;
  private lastExtractSecond = -1;
  private lastStatus = '';
  private lastHeartbeat = 0;
  private lastDustAt = new Map<number, number>();
  private readonly shotSoundAt = new Map<number, number>();

  constructor(
    private readonly container: HTMLElement,
    private readonly client: GameClient,
    private readonly controls: InputController,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-webgl';
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();
    this.scene.background = new THREE.Color(COLORS.background);

    // Late-afternoon mood: warm low key light, cool sky fill, faint cool rim
    // from the opposite side so shadowed faces keep their shape.
    this.scene.add(new THREE.HemisphereLight(COLORS.sky, COLORS.groundBounce, 0.82));
    const rim = new THREE.DirectionalLight(COLORS.rim, 0.55);
    rim.position.set(900, 700, -900);
    this.scene.add(rim);
    this.sun = new THREE.DirectionalLight(COLORS.sun, 3.2);
    this.sun.castShadow = true;
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
    this.scene.add(this.sun, this.sun.target, this.muzzleLight);

    this.effects = new Effects((ownerId, wIndex, x, y) => this.onRemoteShot(ownerId, wIndex, x, y));
    this.scene.add(this.effects.root);
    this.labels = new Labels(container);

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Threshold > 1: only HDR emissives (beams, visors, tracers) bloom, not bright surfaces.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.02);
    this.composer.addPass(this.bloom);
    this.grade = new GradePass();
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair';
    this.crosshair.innerHTML = '<i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><b class="ch-dot"></b><em class="ch-hit"></em>';
    container.appendChild(this.crosshair);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps-meter';
    container.appendChild(this.fpsEl);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.unsubscribeSettings = settings.subscribe(() => this.applySettings());
    this.applySettings();

    if (import.meta.env.DEV) {
      (window as unknown as { __extractRenderer?: unknown }).__extractRenderer = {
        info: () => ({ ...this.renderer.info.render, level: this.level, frameEma: +this.frameEma.toFixed(2) }),
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
    this.crosshair.style.transform = `translate3d(${e.clientX - r.left}px, ${e.clientY - r.top}px, 0)`;
    this.crosshair.classList.add('is-on');
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.onPointerMove(e);
    if (e.button === 0) this.controls.mouseDown = true;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.controls.mouseDown = false;
  };

  private readonly onPointerLeave = (): void => {
    this.crosshair.classList.remove('is-on');
  };

  private computeAim(): number {
    if (!this.hasPointer || !this.client.predictionReady) return this.aim;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint)) {
      this.aim = Math.atan2(this.aimPoint.z - this.client.renderY, this.aimPoint.x - this.client.renderX);
    }
    return this.aim;
  }

  // ----------------------------------------------------------- layout / quality

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
    this.grade.setAspect(w / h);
    this.labels.setSize(w, h);
  }

  private applySettings(): void {
    const s = settings.get();
    this.fpsEl.style.display = s.showFps ? '' : 'none';
    this.setLevel(s.quality === 'auto' ? this.level : s.quality, true);
  }

  private setLevel(level: QualityLevel, force = false): void {
    if (level === this.level && !force) return;
    this.level = level;
    const p = PRESETS[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.dpr));
    this.bloom.enabled = p.bloom;
    if (this.sun.shadow.mapSize.x !== p.shadow) {
      this.sun.shadow.mapSize.set(p.shadow, p.shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  /** Auto quality: step down on sustained slow frames, back up when there is headroom. */
  private autoQuality(frameMs: number, now: number): void {
    // Single hitches (tab switch, GC, shader compile) are not representative.
    if (frameMs > 80 || document.hidden) {
      this.lastQualityCheck = now;
      return;
    }
    this.frameEma += (frameMs - this.frameEma) * 0.05;
    if (settings.get().quality !== 'auto' || now - this.lastQualityCheck < 1000) return;
    this.lastQualityCheck = now;
    const idx = LEVELS.indexOf(this.level);
    if (this.frameEma > 20) {
      this.goodChecks = 0;
      if (++this.badChecks >= 3 && idx > 0) {
        this.setLevel(LEVELS[idx - 1]!);
        this.badChecks = 0;
        this.frameEma = 16.7;
      }
    } else if (this.frameEma < 13) {
      this.badChecks = 0;
      if (++this.goodChecks >= 8 && idx < LEVELS.indexOf('high')) {
        this.setLevel(LEVELS[idx + 1]!);
        this.goodChecks = 0;
      }
    } else {
      this.goodChecks = 0;
      this.badChecks = 0;
    }
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
    this.updateFeel(now);
    this.updateCamera(dt);
    this.updateCrosshair(dt);
    this.labels.updateDamage(this.camera);
    this.muzzleLight.intensity *= Math.exp(-dt * 28);
    const me = c.self;
    const hurt = me && c.status === 'playing' && me.hp > 0 ? Math.max(0, Math.min(1, (40 - me.hp) / 30)) : 0;
    this.grade.setState(hurt, me?.extraction ? 1 : 0, dt);

    if (PRESETS[this.level].composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.autoQuality(frameMs, now);
    this.fpsFrames++;
    if (now - this.fpsLastAt >= 500) {
      const fps = (this.fpsFrames * 1000) / (now - this.fpsLastAt);
      this.fpsEl.textContent = `${Math.round(fps)} FPS · ${this.frameEma.toFixed(1)} ms · ${c.getHud().ping} ms ping · ${this.level.toUpperCase()}`;
      this.fpsFrames = 0;
      this.fpsLastAt = now;
    }
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
    const flags =
      (s.bountyCents > 0 ? PLAYER_FLAGS.BOUNTY : 0) |
      (s.status === 'EXTRACTING' ? PLAYER_FLAGS.EXTRACTING : 0) |
      (isTierAtLeast(s.bagValue, THREAT_CONFIG.kingpinReveal.minTier) ? PLAYER_FLAGS.KINGPIN : 0);
    this.self.update(c.renderX, c.renderY, this.aim, flags, dt, time);

    if (this.self.root.visible) {
      if (c.predicted.dashTime > 0) this.effects.trail(c.renderX, c.renderY, this.self.skin.visor);
      this.maybeDust(-1, c.renderX, c.renderY, this.self.speed);
    }
  }

  private maybeDust(id: number, x: number, y: number, speed: number): void {
    if (speed < 150) return;
    const now = performance.now();
    if (now - (this.lastDustAt.get(id) ?? 0) < 140) return;
    this.lastDustAt.set(id, now);
    this.effects.dust(x, y);
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
      this.maybeDust(p.id, p.x, p.y, model.speed);
      const tag =
        p.flags & PLAYER_FLAGS.KINGPIN
          ? 'KINGPIN'
          : p.flags & PLAYER_FLAGS.BOUNTY
            ? 'HVT'
            : p.flags & PLAYER_FLAGS.DISCONNECTED
              ? 'OFFLINE'
              : p.flags & PLAYER_FLAGS.EXTRACTING
                ? 'EXTRACTING'
                : null;
      this.labels.updatePlayer(this.camera, p.id, p.name, p.bot, p.x, p.y, p.hp, p.maxHp, p.armor, tag);
    }
    for (const [id, model] of this.players) {
      if (!this.seenIds.has(id)) {
        model.dispose();
        this.players.delete(id);
        this.lastHp.delete(id);
        this.lastDustAt.delete(id);
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

  /** A remote player's shot: recoil on their model + positional sound (pellets deduped). */
  private onRemoteShot(ownerId: number, wIndex: number, x: number, y: number): void {
    this.players.get(ownerId)?.fire();
    const now = performance.now();
    if (now - (this.shotSoundAt.get(ownerId) ?? 0) < 40) return;
    this.shotSoundAt.set(ownerId, now);
    const def = weaponFromIndex(wIndex);
    if (!def) return;
    const c = this.client;
    const dx = x - c.renderX;
    const dy = y - c.renderY;
    sound.shot(def.id, Math.hypot(dx, dy), dx / 700);
  }

  private drainFx(): void {
    const c = this.client;
    while (c.fx.length > 0) {
      const ev = c.fx.shift()!;
      switch (ev.e) {
        case 'localShot': {
          this.self?.fire();
          this.shake = Math.max(this.shake, ev.weaponId === 'shotgun' ? 0.45 : 0.14);
          this.spread = Math.min(1, this.spread + (ev.weaponId === 'shotgun' ? 0.8 : 0.35));
          sound.shot(ev.weaponId);
          this.muzzleLight.intensity = 9000;
          this.muzzleLight.position.set(c.renderX + Math.cos(this.aim) * 50, 34, c.renderY + Math.sin(this.aim) * 50);
          break;
        }
        case 'dryFire':
          sound.dryFire();
          break;
        case 'dash':
          sound.dash();
          break;
        case 'dmg':
          this.labels.showDamage(ev.x, ev.y, ev.amount, ev.armor);
          this.hitmarker('hit');
          sound.hitmarker();
          break;
        case 'hurt':
          this.shake = 1;
          this.self?.hit();
          sound.hurt();
          break;
        case 'kill': {
          const victim = c.players.get(ev.victimId);
          if (victim) this.effects.deathBurst(victim.x, victim.y);
          else if (ev.victimId === c.playerId) this.effects.deathBurst(c.renderX, c.renderY);
          if (ev.killerId !== null && ev.killerId === c.playerId) {
            this.hitmarker('kill');
            sound.kill();
          }
          break;
        }
        case 'loot':
          sound.pickup(ev.rarity as Rarity);
          break;
        case 'announce':
          sound.announce(ev.kind);
          break;
        case 'extract':
          if (ev.state === 'cancelled') sound.extractCancel();
          break;
        case 'kingpin':
          sound.kingpin();
          break;
        default:
          break;
      }
    }
  }

  /** Reload / extraction ticks / heartbeat / extracted jingle from state transitions. */
  private updateFeel(now: number): void {
    const c = this.client;
    const s = c.self;
    if (c.status !== this.lastStatus) {
      if (c.status === 'extracted') sound.extracted();
      this.lastStatus = c.status;
    }
    if (!s || c.status !== 'playing') return;
    if (s.reloadRemainingMs > 0 && this.lastReloadMs === 0) sound.reload();
    this.lastReloadMs = s.reloadRemainingMs;
    const sec = s.extraction ? Math.ceil(s.extraction.remainingMs / 1000) : -1;
    if (sec !== this.lastExtractSecond && sec > 0) sound.tick(sec <= 3);
    this.lastExtractSecond = sec;
    if (s.hp > 0 && s.hp < 30 && now - this.lastHeartbeat > 1100) {
      this.lastHeartbeat = now;
      sound.heartbeat();
    }
  }

  private hitmarker(kind: 'hit' | 'kill'): void {
    const el = this.crosshair;
    el.classList.remove('is-hit', 'is-kill');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(kind === 'kill' ? 'is-kill' : 'is-hit');
  }

  private updateCrosshair(dt: number): void {
    const s = this.client.self;
    const w = s?.weapons[s.activeSlot];
    const base = w ? WEAPONS[w.weaponId].spread * 120 : 4;
    this.spread = Math.max(0, this.spread - dt * 3.5);
    const gap = 5 + base + this.spread * 14;
    this.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    this.crosshair.classList.toggle('is-hidden', this.client.status !== 'playing' || this.controls.blocked);
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
      // The camera is locked to the player (no floaty trailing); only the
      // look-ahead towards the crosshair is smoothed.
      const want = this.hasPointer ? Math.min(90, Math.hypot(this.aimPoint.x - c.renderX, this.aimPoint.z - c.renderY) * 0.12) : 0;
      const k = 1 - Math.exp(-dt * 6);
      this.look.x += (Math.cos(this.aim) * want - this.look.x) * k;
      this.look.y += (Math.sin(this.aim) * want - this.look.y) * k;
      this.camTarget.set(c.renderX + this.look.x, 0, c.renderY + this.look.y);
    }

    this.shake = Math.max(0, this.shake - dt * 4);
    const amp = this.shake * this.shake * 16;
    const sx = (Math.random() - 0.5) * amp;
    const sz = (Math.random() - 0.5) * amp;
    this.camera.position.set(this.camTarget.x + sx, Math.cos(TILT) * distance, this.camTarget.z + Math.sin(TILT) * distance + sz);
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z + sz);

    // Sun follows the view; snapped to shadow texels to avoid shimmering edges.
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const lx = Math.round(this.camTarget.x / texel) * texel;
    const lz = Math.round(this.camTarget.z / texel) * texel;
    this.sun.target.position.set(lx, 0, lz);
    this.sun.position.set(lx - 900, 1050, lz + 720);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.unsubscribeSettings();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.effects.dispose();
    this.labels.dispose();
    for (const m of this.players.values()) m.dispose();
    this.self?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.crosshair.remove();
    this.fpsEl.remove();
    canvas.remove();
  }
}
