import { NETWORK_CONFIG, RARITY_CONFIG, THREAT_CONFIG, WEAPONS, getItemDef, weaponIndex } from '@extract/game-config';
import { PLAYER_FLAGS, type MuzzleFlashType, type Rarity, type WeaponDefinition } from '@extract/game-types';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { isTierAtLeast } from '@extract/shared';
import { settings, type QualitySetting } from '../../lib/settings';
import { sound, type ImpactSurface } from '../audio/SoundEngine';
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
import { WeaponDebug } from './WeaponDebug';

const FOV = 38;
const TILT = THREE.MathUtils.degToRad(19);
const SHADOW_EXTENT = 1150;
/** Camera recoil spring (stiffness, damping) and its max offset (world units). */
const KICK_K = 190;
const KICK_C = 2 * Math.sqrt(KICK_K);
const KICK_MAX = 20;

type QualityLevel = Exclude<QualitySetting, 'auto'>;
const LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const PRESETS: Record<QualityLevel, { dpr: number; composer: boolean; bloom: boolean; shadow: number; particles: number }> = {
  low: { dpr: 0.75, composer: false, bloom: false, shadow: 1024, particles: 0.35 },
  medium: { dpr: 1, composer: true, bloom: false, shadow: 1024, particles: 0.7 },
  high: { dpr: 1.5, composer: true, bloom: true, shadow: 2048, particles: 1 },
  ultra: { dpr: 2, composer: true, bloom: true, shadow: 4096, particles: 1 },
};

/** Real light thrown by our own muzzle flash (remote flashes use cheap ground decals). */
const MUZZLE_LIGHT: Record<MuzzleFlashType, { intensity: number; color: number }> = {
  pistol: { intensity: 6000, color: 0xffc27a },
  magnum: { intensity: 10000, color: 0xffb262 },
  smg: { intensity: 5000, color: 0xffc98a },
  suppressed: { intensity: 1800, color: 0xffe0b8 },
  rifle: { intensity: 8000, color: 0xffbd72 },
  battle: { intensity: 11000, color: 0xffac58 },
  shotgun: { intensity: 14000, color: 0xffa24a },
  sniper: { intensity: 13000, color: 0xffc680 },
  lmg: { intensity: 7500, color: 0xffb468 },
  void: { intensity: 10000, color: 0xa35cff },
};

const RELOAD_CIRC = 2 * Math.PI * 17;

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
  private readonly debug: WeaponDebug;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeSettings: () => void;
  private map: MapVisuals | null = null;
  private self: CharacterModel | null = null;
  private readonly players = new Map<number, CharacterModel>();
  /** Bodies playing their death animation (no longer replicated). */
  private readonly dying: CharacterModel[] = [];
  /** Killed players whose replication has not been removed yet (never re-spawn a model). */
  private readonly deadIds = new Set<number>();
  private readonly lastHp = new Map<number, number>();
  private readonly lastArmor = new Map<number, number>();
  private readonly items = new Map<number, GroundItemModel>();
  private itemsSynced = false;
  private readonly crates = new Map<number, CrateModel>();
  private readonly seenIds = new Set<number>();

  // Input / aim
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly cursorPx = new THREE.Vector2(0, 0);
  private hasPointer = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GUN_HEIGHT);
  private readonly aimPoint = new THREE.Vector3();
  private aim = 0;

  // Camera
  private readonly camTarget = new THREE.Vector3();
  private readonly look = new THREE.Vector2();
  private readonly camKick = new THREE.Vector2();
  private readonly camKickVel = new THREE.Vector2();
  private shake = 0;

  // DOM overlays
  private readonly crosshair: HTMLDivElement;
  private readonly chRing: SVGCircleElement;
  private readonly chNote: HTMLSpanElement;
  private readonly fpsEl: HTMLDivElement;
  private chGap = 8;
  private chPunch = 0;
  private chNoteText = '';

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
  private reloadKey = -1;
  private reloadPhase = 0;
  private lastExtractSecond = -1;
  private lastStatus = '';
  private lastHeartbeat = 0;
  private lastImpactSoundAt = 0;
  private lastWhizAt = 0;
  private nextMoteAt = 0;
  private readonly lastDustAt = new Map<number, number>();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

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

    this.effects = new Effects({
      onRemoteShot: (ownerId, def, x, y, angle) => this.onRemoteShot(ownerId, def, x, y, angle),
      onImpact: (surface, x, y) => this.onImpact(surface, x, y),
      onWhiz: (x) => this.onWhiz(x),
    });
    this.scene.add(this.effects.root);
    this.labels = new Labels(container);
    this.debug = new WeaponDebug(this.scene, container);

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
    this.crosshair.innerHTML =
      '<div class="ch-spread"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><s class="ch-circle"></s></div>' +
      `<svg class="ch-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" stroke-dasharray="${RELOAD_CIRC.toFixed(2)}" stroke-dashoffset="${RELOAD_CIRC.toFixed(2)}"/></svg>` +
      '<b class="ch-dot"></b><em class="ch-hit"></em><span class="ch-note"></span>';
    this.chRing = this.crosshair.querySelector('circle')!;
    this.chNote = this.crosshair.querySelector('.ch-note')!;
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
        setLevel: (l: QualityLevel) => this.setLevel(l, true),
        /** Smoke-test helpers: point the cursor at a screen fraction / hold the trigger. */
        aimAt: (fx: number, fy: number) => {
          const r = this.renderer.domElement.getBoundingClientRect();
          this.onPointerMove(new PointerEvent('pointermove', { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }));
        },
        fire: (on: boolean) => {
          this.controls.mouseDown = on;
        },
        /** Visible meshes per top-level scene object (find draw-call hogs). */
        sceneStats: () => {
          const out: Record<string, number> = {};
          const count = (o: THREE.Object3D) => {
            let n = 0;
            o.traverseVisible((x) => {
              if ((x as THREE.Mesh).isMesh || (x as THREE.Sprite).isSprite) n++;
            });
            return n;
          };
          out.map = this.map ? count(this.map.root) : 0;
          out.effects = count(this.effects.root);
          out.self = this.self ? count(this.self.root) : 0;
          out.players = [...this.players.values()].reduce((n, m) => n + count(m.root), 0);
          out.items = [...this.items.values()].reduce((n, m) => n + count(m.root), 0);
          out.itemCount = this.items.size;
          out.crates = [...this.crates.values()].reduce((n, m) => n + count(m.root), 0);
          out.crateCount = this.crates.size;
          out.total = count(this.scene);
          return out;
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
    this.cursorPx.set(e.clientX - r.left, e.clientY - r.top);
    this.hasPointer = true;
    this.crosshair.style.transform = `translate3d(${this.cursorPx.x}px, ${this.cursorPx.y}px, 0)`;
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
    this.effects.setDensity(p.particles);
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
    // Events first: a kill must claim the victim's model before syncPlayers disposes it.
    this.drainFx();
    this.syncPlayers(dt, time);
    this.updateDying(dt);
    this.syncItems(time);
    this.syncCrates(dt, time);
    this.effects.update(c, dt, time);
    this.map?.setVaultActive(c.global?.highValueActive ?? false, time);
    this.updateZoneLabels();
    this.updateFeel(now);
    this.updateCamera(dt);
    this.updateCrosshair(dt);
    this.labels.updateDamage(this.camera);
    this.debug.update(c, this.self, this.camera, this.aim);
    this.muzzleLight.intensity *= Math.exp(-dt * 30);
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
    this.self.setWeapon(weaponIndex(c.activeWeapon?.weaponId));
    const reload = c.reloadView();
    const flags =
      (s.bountyCents > 0 ? PLAYER_FLAGS.BOUNTY : 0) |
      (s.status === 'EXTRACTING' ? PLAYER_FLAGS.EXTRACTING : 0) |
      (reload ? PLAYER_FLAGS.RELOADING : 0) |
      (isTierAtLeast(s.bagValue, THREAT_CONFIG.kingpinReveal.minTier) ? PLAYER_FLAGS.KINGPIN : 0);
    this.self.update(c.renderX, c.renderY, this.aim, flags, dt, time, reload ? Math.min(1, reload.progress) : null);
    this.updateReloadSounds();

    if (this.self.root.visible) {
      if (c.predicted.dashTime > 0) this.effects.trail(c.renderX, c.renderY, this.self.skin.visor);
      this.maybeDust(-1, c.renderX, c.renderY, this.self.speed);
    }
  }

  /** Magazine reloads: mag-out at the start, mag-in mid-way, charge near the end. */
  private updateReloadSounds(): void {
    const c = this.client;
    const view = c.reloadView();
    const def = c.activeDef;
    if (!view || !def) {
      this.reloadPhase = 0;
      return;
    }
    if (view.key !== this.reloadKey) {
      this.reloadKey = view.key;
      this.reloadPhase = 1;
      sound.weaponReload(def.audio.reload, 'start');
    }
    if (def.reloadStyle === 'SHELL') return;
    if (this.reloadPhase < 2 && view.progress >= 0.5) {
      this.reloadPhase = 2;
      sound.weaponReload(def.audio.reload, 'mid');
    }
    if (this.reloadPhase < 3 && view.progress >= 0.8) {
      this.reloadPhase = 3;
      sound.weaponReload(def.audio.reload, 'end');
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
    for (const id of this.deadIds) if (!c.players.has(id)) this.deadIds.delete(id);
    for (const p of c.players.values()) {
      if (this.deadIds.has(p.id)) continue;
      this.seenIds.add(p.id);
      let model = this.players.get(p.id);
      if (!model) {
        model = new CharacterModel(skinFor(p.name), false);
        this.players.set(p.id, model);
        this.scene.add(model.root);
      }
      const prevHp = this.lastHp.get(p.id);
      const prevArmor = this.lastArmor.get(p.id);
      if (prevHp !== undefined && p.hp < prevHp) model.hit();
      else if (prevArmor !== undefined && p.armor < prevArmor) model.hit();
      this.lastHp.set(p.id, p.hp);
      this.lastArmor.set(p.id, p.armor);
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
        this.forgetPlayer(id);
      }
    }
    this.labels.retainPlayers(this.seenIds);
  }

  private forgetPlayer(id: number): void {
    this.players.delete(id);
    this.lastHp.delete(id);
    this.lastArmor.delete(id);
    this.lastDustAt.delete(id);
  }

  private updateDying(dt: number): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const m = this.dying[i]!;
      if (!m.updateDeath(dt)) {
        m.dispose();
        this.dying.splice(i, 1);
      }
    }
  }

  private syncItems(time: number): void {
    const c = this.client;
    for (const [id, m] of this.items) {
      if (!c.items.has(id)) {
        m.dispose();
        this.items.delete(id);
      }
    }
    const motes = time >= this.nextMoteAt;
    if (motes) this.nextMoteAt = time + 320;
    for (const it of c.items.values()) {
      let m = this.items.get(it.id);
      if (!m) {
        // Items appearing mid-game (drops, spills) pop out; the initial world is already settled.
        m = new GroundItemModel(it.itemId, it.x, it.y, this.itemsSynced);
        this.items.set(it.id, m);
        this.scene.add(m.root);
      }
      m.update(time);
      if (motes && m.rank >= 3 && Math.abs(it.x - this.camTarget.x) < 900 && Math.abs(it.y - this.camTarget.z) < 600) this.effects.mote(it.x, it.y, m.color);
    }
    if (c.predictionReady) this.itemsSynced = true;
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
      if (m.setState(cr.opened, cr.locked)) {
        const big = cr.type === 'LEGENDARY' || cr.type === 'SUPPLY_DROP';
        this.effects.crateOpen(cr.x, cr.y, m.glowColor, big);
        if (Math.hypot(cr.x - c.renderX, cr.y - c.renderY) < 500) sound.crateOpen(big);
      }
      m.update(dt, time);
    }
  }

  /** A remote player's shot: kick + flash on their model, smoke, casing, positional sound. */
  private onRemoteShot(ownerId: number, def: WeaponDefinition, x: number, y: number, angle: number): void {
    const model = this.players.get(ownerId);
    if (model) {
      model.fire();
      const m = model.muzzleWorld(this.v1);
      this.effects.muzzle(m.x, m.y, m.z, angle, def);
      const e = model.ejectWorld(this.v2);
      this.effects.casings.eject(e.x, e.y, e.z, angle, def.visual.casing);
    }
    const c = this.client;
    const dx = x - c.renderX;
    const dy = y - c.renderY;
    sound.weaponFire(def.id, Math.hypot(dx, dy), Math.max(-1, Math.min(1, dx / 700)));
  }

  private onImpact(surface: ImpactSurface, x: number, y: number): void {
    const now = performance.now();
    if (now - this.lastImpactSoundAt < 45) return;
    const c = this.client;
    const d = Math.hypot(x - c.renderX, y - c.renderY);
    if (d > 650) return;
    this.lastImpactSoundAt = now;
    sound.impact(surface, d, Math.max(-1, Math.min(1, (x - c.renderX) / 600)));
  }

  private onWhiz(x: number): void {
    const now = performance.now();
    if (now - this.lastWhizAt < 110) return;
    this.lastWhizAt = now;
    sound.whiz(Math.max(-1, Math.min(1, (x - this.client.renderX) / 80)));
  }

  /** Our own round (predicted instantly). */
  private onLocalShot(def: WeaponDefinition, angle: number, streak: number): void {
    const model = this.self;
    const v = def.visual;
    if (model) {
      model.fire();
      const m = model.muzzleWorld(this.v1);
      this.effects.muzzle(m.x, m.y, m.z, angle, def);
      const light = MUZZLE_LIGHT[v.muzzleFlash];
      this.muzzleLight.color.setHex(light.color);
      this.muzzleLight.intensity = light.intensity;
      this.muzzleLight.position.set(m.x, m.y + 8, m.z);
      const e = model.ejectWorld(this.v2);
      this.effects.casings.eject(e.x, e.y, e.z, angle, v.casing);
    }
    // Camera recoil: a short push against the shot direction, sprung back.
    this.camKick.x -= Math.cos(angle) * v.cameraKick;
    this.camKick.y -= Math.sin(angle) * v.cameraKick;
    if (this.camKick.length() > KICK_MAX) this.camKick.setLength(KICK_MAX);
    this.shake = Math.min(1, Math.max(this.shake, v.screenShake + (streak > 3 ? v.vibration * 0.12 : 0)));
    this.chPunch = Math.min(1, this.chPunch + 0.35 + def.recoil * 0.5);
    sound.weaponFire(def.id, 0, 0, streak);
  }

  private drainFx(): void {
    const c = this.client;
    while (c.fx.length > 0) {
      const ev = c.fx.shift()!;
      switch (ev.e) {
        case 'localShot':
          this.onLocalShot(WEAPONS[ev.weaponId], ev.angle, ev.streak);
          break;
        case 'dryFire':
          sound.weaponEmpty();
          this.flashNote();
          break;
        case 'equip':
          sound.weaponEquip(WEAPONS[ev.weaponId].audio.equip);
          break;
        case 'reloadStart':
        case 'reloadDone':
          if (ev.e === 'reloadDone' && WEAPONS[ev.weaponId].reloadStyle === 'SHELL') sound.weaponReload('shell', 'end');
          break;
        case 'shellIn':
          sound.weaponShellIn();
          this.self?.shellIn();
          break;
        case 'pierce':
          this.effects.playerHit(ev.x, ev.y, ev.dx, ev.dy, false);
          break;
        case 'dash':
          sound.dash();
          break;
        case 'dmg':
          this.labels.showDamage(ev.targetId, ev.x, ev.y, ev.amount, ev.armor);
          this.hitmarker(ev.killed ? 'kill' : ev.armor ? 'armor' : 'hit');
          sound.hitmarker(ev.armor);
          break;
        case 'hurt':
          this.shake = Math.min(1, this.shake + 0.35);
          this.self?.hit();
          sound.hurt(ev.armor ?? false);
          break;
        case 'kill':
          this.onKill(ev.victimId, ev.killerId);
          break;
        case 'loot':
          this.onLoot(ev.itemId, ev.rarity);
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

  private onKill(victimId: number, killerId: number | null): void {
    const c = this.client;
    const side = Math.random() < 0.5 ? -1 : 1;
    const victim = this.players.get(victimId);
    if (victim) {
      this.effects.deathBurst(victim.root.position.x, victim.root.position.z);
      victim.die(side);
      this.dying.push(victim);
      this.forgetPlayer(victimId);
      this.deadIds.add(victimId);
    } else if (victimId === c.playerId && this.self) {
      // Our own body stays behind as a corpse; the live model hides.
      const corpse = new CharacterModel(this.self.skin, false);
      corpse.setWeapon(weaponIndex(c.activeWeapon?.weaponId), false);
      corpse.update(c.renderX, c.renderY, this.aim, 0, 0, 0);
      this.scene.add(corpse.root);
      corpse.die(side);
      this.dying.push(corpse);
      this.effects.deathBurst(c.renderX, c.renderY);
    }
    if (killerId !== null && killerId === c.playerId) sound.kill();
  }

  private onLoot(itemId: string, rarity: Rarity): void {
    const c = this.client;
    const def = getItemDef(itemId);
    const cfg = RARITY_CONFIG[rarity];
    sound.pickup(rarity);
    if (def.type === 'WEAPON') sound.weaponPickup();
    if (cfg.rank >= RARITY_CONFIG.LEGENDARY.rank) {
      this.effects.legendaryBurst(c.renderX, c.renderY, cfg.colorHex);
      this.grade.flash(cfg.colorHex, 0.55);
      this.shake = Math.min(1, this.shake + 0.25);
    } else if (cfg.rank >= 1) this.effects.lootBurst(c.renderX, c.renderY, cfg.colorHex, cfg.rank);
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
    const sec = s.extraction ? Math.ceil(s.extraction.remainingMs / 1000) : -1;
    if (sec !== this.lastExtractSecond && sec > 0) sound.tick(sec <= 3);
    this.lastExtractSecond = sec;
    if (s.hp > 0 && s.hp < 30 && now - this.lastHeartbeat > 1100) {
      this.lastHeartbeat = now;
      sound.heartbeat();
    }
  }

  private hitmarker(kind: 'hit' | 'armor' | 'kill'): void {
    const el = this.crosshair;
    el.classList.remove('is-hit', 'is-armor', 'is-kill');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(kind === 'kill' ? 'is-kill' : kind === 'armor' ? 'is-armor' : 'is-hit');
  }

  private flashNote(): void {
    this.chNote.classList.remove('is-flash');
    void this.chNote.offsetWidth;
    this.chNote.classList.add('is-flash');
  }

  /**
   * The crosshair draws the real spread cone at the cursor's distance: the
   * gap is where a round at the edge of the cone would cross the cursor.
   */
  private updateCrosshair(dt: number): void {
    const c = this.client;
    const el = this.crosshair;
    el.classList.toggle('is-hidden', c.status !== 'playing' || this.controls.blocked);
    const def = c.activeDef;
    // Player on screen.
    this.v1.set(c.renderX, GUN_HEIGHT, c.renderY).project(this.camera);
    const px = ((this.v1.x + 1) / 2) * this.width;
    const py = ((1 - this.v1.y) / 2) * this.height;
    const dist = Math.max(40, Math.hypot(this.cursorPx.x - px, this.cursorPx.y - py));
    const target = def ? Math.max(3, Math.min(140, Math.tan(c.currentSpread()) * dist)) : 6;
    // Opens instantly, closes smoothly.
    this.chGap = target > this.chGap ? target : this.chGap + (target - this.chGap) * Math.min(1, dt * 14);
    this.chPunch = Math.max(0, this.chPunch - dt * 6);
    el.style.setProperty('--gap', `${(this.chGap + this.chPunch * 5).toFixed(1)}px`);
    el.style.setProperty('--punch', (1 + this.chPunch * 0.12).toFixed(3));
    el.classList.toggle('is-pellets', !!def && def.pelletCount > 1);

    const reload = c.reloadView();
    el.classList.toggle('is-reload', !!reload);
    if (reload) this.chRing.setAttribute('stroke-dashoffset', (RELOAD_CIRC * (1 - Math.min(1, reload.progress))).toFixed(2));

    const mag = c.displayMag();
    const reserve = def && c.self ? c.self.ammo[def.ammoType] : 0;
    const low = !!def && mag !== null && mag > 0 && mag <= Math.ceil(def.magazineSize * 0.25);
    el.classList.toggle('is-low', low);
    let note = '';
    if (def && mag === 0 && !reload) note = reserve > 0 ? 'RELOAD' : 'NO AMMO';
    else if (c.currentWeaponPhase() === 'SWITCHING') note = '';
    if (note !== this.chNoteText) {
      this.chNoteText = note;
      this.chNote.textContent = note;
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
      // The camera is locked to the player (no floaty trailing); only the
      // look-ahead towards the crosshair is smoothed.
      const want = this.hasPointer ? Math.min(90, Math.hypot(this.aimPoint.x - c.renderX, this.aimPoint.z - c.renderY) * 0.12) : 0;
      const k = 1 - Math.exp(-dt * 6);
      this.look.x += (Math.cos(this.aim) * want - this.look.x) * k;
      this.look.y += (Math.sin(this.aim) * want - this.look.y) * k;
      this.camTarget.set(c.renderX + this.look.x, 0, c.renderY + this.look.y);
    }

    // Recoil spring (critically damped): never moves the aim point, only the view.
    const step = Math.min(dt, 0.05);
    this.camKickVel.x += (-KICK_K * this.camKick.x - KICK_C * this.camKickVel.x) * step;
    this.camKickVel.y += (-KICK_K * this.camKick.y - KICK_C * this.camKickVel.y) * step;
    this.camKick.x += this.camKickVel.x * step;
    this.camKick.y += this.camKickVel.y * step;

    this.shake = Math.max(0, this.shake - dt * 3.2);
    const amp = this.shake * this.shake * 11;
    const sx = (Math.random() - 0.5) * amp + this.camKick.x;
    const sz = (Math.random() - 0.5) * amp + this.camKick.y;
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
    this.debug.dispose();
    for (const m of this.players.values()) m.dispose();
    for (const m of this.dying) m.dispose();
    this.self?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.crosshair.remove();
    this.fpsEl.remove();
    canvas.remove();
  }
}
