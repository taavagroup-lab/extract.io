import { NETWORK_CONFIG, PLAYER_CONFIG, RARITY_CONFIG, WEAPONS, reloadDuration, weaponFromIndex, weaponIndex } from '@extract/game-config';
import {
  INPUT_BUTTONS,
  PLAYER_STATUSES,
  type BulletEnd,
  type BulletSpawn,
  type ClientAction,
  type ClientMessage,
  type CrateView,
  type DeathSummary,
  type DevCommand,
  type ExtractionSummary,
  type GameEvent,
  type GroundItemView,
  type InputCmd,
  type InventoryOp,
  type InventoryState,
  type LobbyState,
  type MapData,
  type MatchEndSummary,
  type MatchGlobalState,
  type ObstacleStyle,
  type PlayerNet,
  type SelfState,
  type ServerMessage,
  type SnapshotMessage,
  type WeaponDefinition,
  type WeaponId,
  type WeaponInstance,
  type WeaponPhase,
} from '@extract/game-types';
import {
  CollisionWorld,
  createWeaponRuntime,
  decodeMessage,
  encodeMessage,
  equipWeaponRuntime,
  lerp,
  lerpAngle,
  moveParamsFor,
  segmentCircle,
  shotAngles,
  stepMovement,
  stepWeapon,
  weaponPhase,
  weaponSpread,
  type MoveState,
} from '@extract/shared';

export type ClientStatus = 'connecting' | 'lobby' | 'playing' | 'dead' | 'extracted' | 'ended' | 'reconnecting' | 'error';

interface Sample {
  t: number;
  x: number;
  y: number;
  rot: number;
}

export interface RemotePlayer {
  id: number;
  name: string;
  bot: boolean;
  samples: Sample[];
  hp: number;
  maxHp: number;
  armor: number;
  weapon: number;
  status: number;
  flags: number;
  /** Interpolated render state. */
  x: number;
  y: number;
  rot: number;
}

export interface ClientBullet {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  speed: number;
  maxDist: number;
  weapon: number;
  ownerId: number;
  born: number;
  /** Distance travelled when the server reported the end (hit). */
  endDist: number | null;
  hitPlayer: boolean;
  /** Predicted locally the moment we fired (instant feedback). */
  local: boolean;
  /** Server copy of one of our own shots: not drawn, only used for hit confirmation. */
  ghost: boolean;
  /** Obstacle style the shot would stop at (impact VFX), null when it flies to max range. */
  surface: ObstacleStyle | null;
  /** Bright tracer round (every Nth per weapon config); the others draw a faint streak. */
  tracer: boolean;
}

export interface InputSample {
  mx: number;
  my: number;
  aim: number;
  fire: boolean;
}

export interface FeedEntry {
  id: number;
  at: number;
  text: string;
  killer: string | null;
  victim: string;
  weapon: string | null;
  bountyCents: number;
  mine: boolean;
  byMe: boolean;
}

export interface Announcement {
  id: number;
  at: number;
  text: string;
  sub?: string;
  kind: 'info' | 'warning' | 'danger' | 'success';
}

export interface LootToast {
  id: number;
  at: number;
  itemId: string;
  qty: number;
  rarity: string;
  value: number;
}

export interface Notice {
  id: number;
  at: number;
  text: string;
}

export interface KingpinAlert {
  id: number;
  at: number;
  playerId: number;
  name: string;
  bagCents: number;
  /** The local player is the KINGPIN. */
  self: boolean;
}

export interface ExtractInterrupt {
  at: number;
  reason: string;
}

/** What [E] would do right now (drives the pickup card). */
export type InteractHint =
  | { kind: 'item'; id: number; itemId: string; qty: number; mag: number | null }
  | { kind: 'crate'; id: number; label: string; locked: boolean };

/** Big-find moment for LEGENDARY+ loot (small, centred, a few seconds). */
export interface LegendaryMoment {
  id: number;
  at: number;
  itemId: string;
  value: number;
}

/** Reload as seen by the HUD (server state or local prediction). */
export interface ReloadView {
  /** Changes whenever a new reload starts (restarts the progress animation). */
  key: number;
  progress: number;
  remainingMs: number;
  totalMs: number;
}

export interface HudState {
  status: ClientStatus;
  error: string | null;
  lobby: LobbyState | null;
  self: SelfState | null;
  inventory: InventoryState;
  global: MatchGlobalState | null;
  feed: FeedEntry[];
  announcements: Announcement[];
  toasts: LootToast[];
  notices: Notice[];
  extractAlertAt: number;
  interactHint: InteractHint | null;
  death: DeathSummary | null;
  extracted: ExtractionSummary | null;
  end: MatchEndSummary | null;
  ping: number;
  devTools: boolean;
  playerName: string;
  hurtAt: number;
  /** Recent hits taken, with direction (for the damage indicator). */
  hurts: { id: number; at: number; angle: number; armor: boolean }[];
  /** Magazine including locally predicted shots (null = no weapon). */
  mag: number | null;
  /** Last KINGPIN announcement (shown for a few seconds). */
  kingpin: KingpinAlert | null;
  /** Last extraction interruption (big red feedback). */
  extractInterrupt: ExtractInterrupt | null;
  /** When the (server-reported) bag value last went up, and by how much. */
  bagGainAt: number;
  bagGain: number;
  /** Weapon slot in hand (includes a predicted, not yet confirmed swap). */
  activeSlot: number;
  weaponPhase: WeaponPhase;
  reload: ReloadView | null;
  legendary: LegendaryMoment | null;
}

/** Events for renderer / audio (server events + purely local predictions). */
export type FxEvent =
  | Extract<GameEvent, { e: 'dmg' } | { e: 'hurt' } | { e: 'extractAlert' } | { e: 'kill' } | { e: 'loot' } | { e: 'announce' } | { e: 'extract' }>
  | Extract<GameEvent, { e: 'kingpin' }>
  /** One of our own rounds (predicted instantly; pellets of one shot count once). */
  | { e: 'localShot'; weaponId: WeaponId; angle: number; streak: number }
  | { e: 'dryFire'; weaponId: WeaponId }
  | { e: 'equip'; weaponId: WeaponId }
  | { e: 'reloadStart'; weaponId: WeaponId; tactical: boolean }
  | { e: 'shellIn'; weaponId: WeaponId }
  | { e: 'reloadDone'; weaponId: WeaponId }
  /** A round passed through a player (piercing weapons). */
  | { e: 'pierce'; x: number; y: number; dx: number; dy: number }
  | { e: 'dash' };

const DT = 1 / NETWORK_CONFIG.tickRate;
const DT_MS = 1000 / NETWORK_CONFIG.tickRate;
const SNAP_INTERVAL = DT_MS * NETWORK_CONFIG.snapshotEveryTicks;
const RECONNECT_ATTEMPT_MS = 1500;
const RECONNECT_GIVE_UP_MS = NETWORK_CONFIG.reconnectWindowMs - 2000;

function gameServerUrl(): string {
  // Dev only: `?gs=ws://localhost:3102/ws` targets another game server (e.g. a bot-free sandbox).
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(window.location.search).get('gs');
    if (override && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(override)) return override;
  }
  const env = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (env) return env;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

/**
 * Networking + client-side simulation. Renders nothing itself: the Three.js
 * renderer reads positions from here, React reads `hud`.
 *
 * - Fixed 30 Hz input steps, predicted locally with the shared movement code.
 * - Server snapshots acknowledge input sequence numbers; unacknowledged
 *   inputs are replayed on top of the authoritative state (reconciliation).
 * - Shots are predicted locally for instant feedback (visual only; the server
 *   still decides every hit).
 * - Remote players are interpolated ~75 ms in the past, briefly extrapolated
 *   when a snapshot is late.
 */
export class GameClient {
  status: ClientStatus = 'connecting';
  map: MapData | null = null;
  world: CollisionWorld | null = null;
  playerId: number | null = null;
  matchId: string | null = null;
  devTools = false;
  playerName = '';

  // Prediction
  readonly predicted: MoveState = { x: 0, y: 0, dashTime: 0, dashCooldown: 0, dashDirX: 0, dashDirY: 0 };
  predictionReady = false;
  private pending: InputCmd[] = [];
  private seq = 0;
  private accumulator = 0;
  private dashQueued = false;
  private smoothX = 0;
  private smoothY = 0;
  /** Position before the last fixed step: rendering interpolates prev -> predicted. */
  private prevX = 0;
  private prevY = 0;
  private alpha = 1;
  aim = 0;
  /** Local shot prediction: the same weapon controller the server runs. */
  readonly weaponRt = createWeaponRuntime();
  private readonly spreadsBuf: number[] = [];
  private readonly anglesBuf: number[] = [];
  private readonly pendingShots = new Map<number, number>();
  private localBulletId = 0;
  private tracerCount = 0;
  private readonly remoteTracerCount = new Map<number, number>();
  private lastAck = 0;
  /** Swap sent but not yet confirmed by a snapshot. */
  private predictedSlot: { slot: number; at: number } | null = null;
  /** Reload started locally (R / empty trigger) before the server confirms it. */
  private localReload: { at: number; totalMs: number; uid: string } | null = null;
  /** Input seq whose trigger pull cancelled a reload; server reload state is ignored until acked. */
  private reloadCancelSeq = 0;
  private reloadKey = 0;
  private serverReloadActive = false;
  private legendary: LegendaryMoment | null = null;
  private hurts: { id: number; at: number; angle: number; armor: boolean }[] = [];

  // Replicated state
  self: SelfState | null = null;
  inventory: InventoryState = { slots: [], secure: null };
  global: MatchGlobalState | null = null;
  readonly players = new Map<number, RemotePlayer>();
  readonly items = new Map<number, GroundItemView>();
  readonly crates = new Map<number, CrateView>();
  readonly bullets: ClientBullet[] = [];
  readonly fx: FxEvent[] = [];
  private timeOffset: number | null = null;
  private lastSnapAt = 0;

  // HUD
  private hud: HudState;
  private hudDirty = true;
  private readonly listeners = new Set<() => void>();
  private feed: FeedEntry[] = [];
  private announcements: Announcement[] = [];
  private toasts: LootToast[] = [];
  private notices: Notice[] = [];
  private extractAlertAt = 0;
  private hurtAt = 0;
  private interactHint: InteractHint | null = null;
  private kingpin: KingpinAlert | null = null;
  private extractInterrupt: ExtractInterrupt | null = null;
  private bagGainAt = 0;
  private bagGain = 0;
  private lobby: LobbyState | null = null;
  private death: DeathSummary | null = null;
  private extracted: ExtractionSummary | null = null;
  private end: MatchEndSummary | null = null;
  private error: string | null = null;
  private ping = 0;
  private uid = 1;

  // Connection
  private ws: WebSocket | null = null;
  private reconnectKey: string | null = null;
  private reconnectStartedAt: number | null = null;
  private disposed = false;
  private readonly timers: number[] = [];

  constructor(
    private readonly token: string | null,
    private readonly name: string,
  ) {
    this.hud = this.buildHud();
    // Debug handle for development tooling (never in production builds).
    if (import.meta.env.DEV) (window as unknown as { __extractClient?: GameClient }).__extractClient = this;
    this.timers.push(window.setInterval(() => this.flushHud(), 100));
    this.timers.push(window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), NETWORK_CONFIG.pingIntervalMs));
  }

  // ------------------------------------------------------------ connection

  connect(): void {
    if (this.disposed) return;
    const ws = new WebSocket(gameServerUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'join', token: this.token, name: this.name, reconnectKey: this.reconnectKey });
    };
    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      try {
        this.handle(decodeMessage(ev.data) as ServerMessage);
      } catch (err) {
        console.error('bad server message', err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.disposed) return;
      this.ws = null;
      this.onConnectionLost();
    };
  }

  private onConnectionLost(): void {
    const recoverable = this.status === 'playing' || this.status === 'lobby' || this.status === 'reconnecting' || this.status === 'connecting';
    if (!recoverable) return;
    const now = performance.now();
    this.reconnectStartedAt ??= now;
    if (now - this.reconnectStartedAt > RECONNECT_GIVE_UP_MS) {
      this.fail('Connection lost. The game server is unreachable.');
      return;
    }
    this.setStatus('reconnecting');
    this.timers.push(window.setTimeout(() => this.connect(), RECONNECT_ATTEMPT_MS));
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeMessage(msg));
  }

  private fail(message: string): void {
    this.error = message;
    this.setStatus('error');
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) {
      window.clearInterval(t);
      window.clearTimeout(t);
    }
    this.listeners.clear();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  // ---------------------------------------------------------- HUD binding

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getHud = (): HudState => this.hud;

  private markHud(): void {
    this.hudDirty = true;
  }

  private setStatus(status: ClientStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.markHud();
    this.flushHud();
  }

  private flushHud(): void {
    const now = performance.now();
    const expire = <T extends { at: number }>(list: T[], ms: number) => list.filter((x) => now - x.at < ms);
    const lens = this.feed.length + this.announcements.length + this.toasts.length + this.notices.length + this.hurts.length;
    this.feed = expire(this.feed, 7000);
    this.announcements = expire(this.announcements, 4200);
    this.toasts = expire(this.toasts, 3600);
    this.notices = expire(this.notices, 2600);
    this.hurts = expire(this.hurts, 1200);
    if (this.kingpin && now - this.kingpin.at > 5200) {
      this.kingpin = null;
      this.hudDirty = true;
    }
    if (this.extractInterrupt && now - this.extractInterrupt.at > 2200) {
      this.extractInterrupt = null;
      this.hudDirty = true;
    }
    if (this.legendary && now - this.legendary.at > 3600) {
      this.legendary = null;
      this.hudDirty = true;
    }
    // Reload progress / swaps move continuously: refresh while they matter.
    if (this.reloadView() || this.weaponRt.equipLeftMs > 0) this.hudDirty = true;
    if (lens !== this.feed.length + this.announcements.length + this.toasts.length + this.notices.length + this.hurts.length) this.hudDirty = true;
    if (!this.hudDirty) return;
    this.hudDirty = false;
    this.hud = this.buildHud();
    for (const l of this.listeners) l();
  }

  private buildHud(): HudState {
    return {
      status: this.status,
      error: this.error,
      lobby: this.lobby,
      self: this.self,
      inventory: this.inventory,
      global: this.global,
      feed: this.feed,
      announcements: this.announcements,
      toasts: this.toasts,
      notices: this.notices,
      extractAlertAt: this.extractAlertAt,
      interactHint: this.interactHint,
      death: this.death,
      extracted: this.extracted,
      end: this.end,
      ping: this.ping,
      devTools: this.devTools,
      playerName: this.playerName,
      hurtAt: this.hurtAt,
      hurts: this.hurts,
      mag: this.displayMag(),
      kingpin: this.kingpin,
      extractInterrupt: this.extractInterrupt,
      bagGainAt: this.bagGainAt,
      bagGain: this.bagGain,
      activeSlot: this.activeSlot,
      weaponPhase: this.currentWeaponPhase(),
      reload: this.reloadView(),
      legendary: this.legendary,
    };
  }

  /** Server magazine minus shots we predicted but the server has not acknowledged yet. */
  displayMag(): number | null {
    const w = this.activeWeapon;
    if (!w) return null;
    let unacked = 0;
    for (const n of this.pendingShots.values()) unacked += n;
    return Math.max(0, w.mag - unacked);
  }

  // ------------------------------------------------------------- commands

  queueDash(): void {
    this.dashQueued = true;
  }

  // ------------------------------------------------------------- weapons

  /** Slot in hand: a swap is shown instantly and confirmed by the server shortly after. */
  get activeSlot(): number {
    const s = this.self;
    if (!s) return 0;
    const p = this.predictedSlot;
    if (p) {
      if (s.activeSlot === p.slot || !s.weapons[p.slot] || performance.now() - p.at > 800) this.predictedSlot = null;
      else return p.slot;
    }
    return s.activeSlot;
  }

  get activeWeapon(): WeaponInstance | null {
    return this.self?.weapons[this.activeSlot] ?? null;
  }

  get activeDef(): WeaponDefinition | null {
    const w = this.activeWeapon;
    return w ? WEAPONS[w.weaponId] : null;
  }

  /** Spread cone (radians, half-angle) the next round flies in: the crosshair shows exactly this. */
  currentSpread(): number {
    const def = this.activeDef;
    return def ? weaponSpread(this.weaponRt, def) + def.pelletSpread : 0;
  }

  currentWeaponPhase(): WeaponPhase {
    const s = this.self;
    const alive = !!s && (s.status === 'ALIVE' || s.status === 'EXTRACTING');
    return weaponPhase(this.weaponRt, this.activeDef, { dead: !alive, reloading: this.isReloading(), mag: this.displayMag() ?? 0 });
  }

  switchWeapon(slot: number): void {
    const s = this.self;
    const w = s?.weapons[slot];
    if (!s || !w || slot === this.activeSlot || !this.canPredict) return;
    this.predictedSlot = { slot, at: performance.now() };
    this.localReload = null;
    this.fx.push({ e: 'equip', weaponId: w.weaponId });
    this.action({ k: 'switch', slot });
    this.markHud();
  }

  reload(): void {
    this.action({ k: 'reload' });
    this.predictReload(false);
  }

  private predictReload(auto: boolean): void {
    const s = this.self;
    const w = this.activeWeapon;
    if (!s || !w || !this.canPredict || this.isReloading() || s.useItem) return;
    const def = WEAPONS[w.weaponId];
    const mag = this.displayMag() ?? 0;
    const total = reloadDuration(def, mag, s.ammo[def.ammoType]);
    if (total <= 0) return;
    this.localReload = { at: performance.now(), totalMs: total, uid: w.uid };
    this.reloadKey++;
    this.fx.push({ e: 'reloadStart', weaponId: def.id, tactical: mag > 0 && !auto });
    this.markHud();
  }

  /** Server reload state, unless our trigger pull already cancelled it. */
  private get serverReloading(): boolean {
    const s = this.self;
    return !!s && s.reloadRemainingMs > 0 && this.reloadCancelSeq <= this.lastAck;
  }

  isReloading(): boolean {
    if (this.serverReloading) return true;
    const r = this.localReload;
    return !!r && performance.now() - r.at < r.totalMs && r.uid === this.activeWeapon?.uid;
  }

  reloadView(): ReloadView | null {
    const s = this.self;
    if (s && this.serverReloading) {
      const total = Math.max(1, s.reloadTotalMs);
      return { key: this.reloadKey, progress: 1 - s.reloadRemainingMs / total, remainingMs: s.reloadRemainingMs, totalMs: total };
    }
    const r = this.localReload;
    if (r && this.isReloading()) {
      const t = performance.now() - r.at;
      return { key: this.reloadKey, progress: t / r.totalMs, remainingMs: r.totalMs - t, totalMs: r.totalMs };
    }
    return null;
  }

  action(a: ClientAction): void {
    this.send({ t: 'act', a });
  }

  inventoryOp(o: InventoryOp): void {
    this.send({ t: 'inv', o });
  }

  dev(d: DevCommand): void {
    this.send({ t: 'dev', d });
  }

  leave(): void {
    this.send({ t: 'leave' });
  }

  // ------------------------------------------------------------- per frame

  get canPredict(): boolean {
    return this.status === 'playing' && this.predictionReady && !!this.world && (this.self?.status === 'ALIVE' || this.self?.status === 'EXTRACTING');
  }

  /** Estimated current match time (ms), for the HUD timer and interpolation. */
  serverNow(): number {
    return this.timeOffset === null ? 0 : performance.now() + this.timeOffset;
  }

  /**
   * Self position to render: interpolated between the last two fixed 30 Hz
   * steps (smooth on 60/144 Hz displays) plus the decaying correction offset.
   */
  get renderX(): number {
    return lerp(this.prevX, this.predicted.x, this.alpha) + this.smoothX;
  }
  get renderY(): number {
    return lerp(this.prevY, this.predicted.y, this.alpha) + this.smoothY;
  }

  update(frameMs: number, input: InputSample): void {
    this.aim = input.aim;
    this.accumulator += Math.min(frameMs, 250);
    const out: InputCmd[] = [];
    while (this.accumulator >= DT_MS) {
      this.accumulator -= DT_MS;
      this.prevX = this.predicted.x;
      this.prevY = this.predicted.y;
      if (!this.canPredict) {
        this.dashQueued = false;
        this.weaponRt.triggerHeld = input.fire;
        continue;
      }
      let b = 0;
      if (input.fire) b |= INPUT_BUTTONS.FIRE;
      if (this.dashQueued) {
        b |= INPUT_BUTTONS.DASH;
        this.dashQueued = false;
      }
      const cmd: InputCmd = { s: ++this.seq, mx: input.mx, my: input.my, a: Math.round(input.aim * 1000) / 1000, b };
      const dashBefore = this.predicted.dashTime;
      stepMovement(this.predicted, cmd, DT, this.world!, moveParamsFor(this.activeDef));
      if (dashBefore <= 0 && this.predicted.dashTime > 0) this.fx.push({ e: 'dash' });
      this.stepLocalWeapon(cmd, input.fire);
      this.pending.push(cmd);
      out.push(cmd);
    }
    for (let i = 0; i < out.length; i += NETWORK_CONFIG.input.maxBatch) {
      this.send({ t: 'input', i: out.slice(i, i + NETWORK_CONFIG.input.maxBatch) });
    }
    if (this.pending.length > 90) this.pending.splice(0, this.pending.length - 90);
    this.alpha = this.accumulator / DT_MS;

    const decay = Math.exp(-frameMs / 60);
    this.smoothX *= decay;
    this.smoothY *= decay;

    this.interpolateRemotes();
    this.updateInteractHint();
  }

  /**
   * Advances the shared weapon controller exactly like the server does for
   * this input. Rounds it fires get instant local feedback (tracer, muzzle
   * flash, recoil, ammo counter); the server still simulates the real
   * bullets and decides every hit.
   */
  private stepLocalWeapon(cmd: InputCmd, fire: boolean): void {
    const s = this.self;
    const rt = this.weaponRt;
    const w = this.activeWeapon;
    if (!s || !w) {
      rt.triggerHeld = fire;
      return;
    }
    const def = WEAPONS[w.weaponId];
    if (rt.key !== w.uid) equipWeaponRuntime(rt, w.uid, def);
    const mag = this.displayMag() ?? 0;
    let reloading = this.isReloading();
    // Same rule as the server: a trigger pull with rounds loaded cancels the reload.
    if (reloading && fire && !rt.triggerHeld && mag > 0) {
      this.localReload = null;
      this.reloadCancelSeq = cmd.s;
      reloading = false;
    }
    const canFire = !reloading && !s.useItem && (s.status === 'ALIVE' || s.status === 'EXTRACTING');
    const n = stepWeapon(rt, def, { trigger: fire, moving: cmd.mx !== 0 || cmd.my !== 0, dashing: this.predicted.dashTime > 0, ammo: mag, canFire }, DT_MS, this.spreadsBuf);
    if (rt.dry) {
      this.fx.push({ e: 'dryFire', weaponId: def.id });
      this.predictReload(true);
    }
    if (n === 0) return;
    this.pendingShots.set(cmd.s, n);
    for (let i = 0; i < n; i++) {
      this.predictRound(def, cmd.a, this.spreadsBuf[i]!);
      this.fx.push({ e: 'localShot', weaponId: def.id, angle: cmd.a, streak: rt.streak });
    }
    if (mag - n <= 0) this.predictReload(true);
    this.markHud();
  }

  private predictRound(def: WeaponDefinition, aim: number, spread: number): void {
    const x0 = this.predicted.x;
    const y0 = this.predicted.y;
    const tracer = this.tracerCount++ % def.visual.tracerEvery === 0;
    for (const angle of shotAngles(def, aim, spread, Math.random, this.anglesBuf)) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let maxDist = def.range;
      let hitPlayer = false;
      const wall = this.world?.raycast(x0, y0, x0 + dx * def.range, y0 + dy * def.range);
      if (wall) maxDist = wall.t * def.range;
      for (const p of this.players.values()) {
        const t = segmentCircle(x0, y0, dx * def.range, dy * def.range, p.x, p.y, PLAYER_CONFIG.radius);
        if (t !== null && t * def.range < maxDist) {
          maxDist = t * def.range;
          hitPlayer = true;
        }
      }
      this.bullets.push({
        id: -++this.localBulletId,
        x0,
        y0,
        dx,
        dy,
        speed: def.projectileSpeed,
        maxDist,
        weapon: weaponIndex(def.id),
        ownerId: this.playerId ?? -1,
        born: performance.now(),
        endDist: null,
        hitPlayer,
        local: true,
        ghost: false,
        surface: hitPlayer ? null : (wall?.obstacle.style ?? null),
        tracer,
      });
    }
  }

  private interpolateRemotes(): void {
    if (this.timeOffset === null) return;
    const renderT = this.serverNow() - NETWORK_CONFIG.interpolationDelayMs;
    for (const p of this.players.values()) {
      const s = p.samples;
      if (s.length === 0) continue;
      // Drop samples we no longer need (keep one before renderT).
      while (s.length > 2 && s[1]!.t <= renderT) s.shift();
      const a = s[0]!;
      const b = s[1];
      if (!b || renderT <= a.t) {
        p.x = a.x;
        p.y = a.y;
        p.rot = a.rot;
      } else if (renderT >= b.t) {
        // Late snapshot: extrapolate briefly, but only for players that were
        // still moving in the newest snapshot (unchanged players get no update).
        const over = b.t === this.lastSnapAt ? Math.min(renderT - b.t, NETWORK_CONFIG.maxExtrapolationMs) : 0;
        const span = Math.max(1, b.t - a.t);
        p.x = b.x + ((b.x - a.x) / span) * over;
        p.y = b.y + ((b.y - a.y) / span) * over;
        p.rot = b.rot;
      } else {
        const t = (renderT - a.t) / (b.t - a.t);
        p.x = lerp(a.x, b.x, t);
        p.y = lerp(a.y, b.y, t);
        p.rot = lerpAngle(a.rot, b.rot, t);
      }
    }
  }

  private updateInteractHint(): void {
    let hint: InteractHint | null = null;
    if (this.canPredict) {
      const r2 = PLAYER_CONFIG.interactRange ** 2;
      let best = Infinity;
      const px = this.predicted.x;
      const py = this.predicted.y;
      for (const it of this.items.values()) {
        const d = (it.x - px) ** 2 + (it.y - py) ** 2;
        if (d < r2 && d < best) {
          best = d;
          hint = { kind: 'item', id: it.id, itemId: it.itemId, qty: it.qty, mag: it.mag ?? null };
        }
      }
      for (const c of this.crates.values()) {
        if (c.opened) continue;
        const d = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (d < r2 && d < best) {
          best = d;
          const label = c.type === 'SUPPLY_DROP' ? 'Supply Drop' : c.type.charAt(0) + c.type.slice(1).toLowerCase() + ' Crate';
          hint = { kind: 'crate', id: c.id, label, locked: c.locked };
        }
      }
    }
    const prev = this.interactHint;
    const same =
      prev === hint ||
      (!!prev && !!hint && prev.kind === hint.kind && prev.id === hint.id && (prev.kind !== 'item' || (hint.kind === 'item' && prev.qty === hint.qty && prev.mag === hint.mag)));
    if (!same) {
      this.interactHint = hint;
      this.markHud();
    }
  }

  // ------------------------------------------------------------- messages

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.onWelcome(msg);
        break;
      case 'lobby':
        this.lobby = { phase: msg.phase, found: msg.found, target: msg.target, humans: msg.humans, countdownMs: msg.countdownMs };
        if (this.status === 'connecting' || this.status === 'reconnecting') this.setStatus('lobby');
        this.markHud();
        break;
      case 'start':
        this.playerId = msg.playerId;
        this.reconnectStartedAt = null;
        this.setStatus('playing');
        break;
      case 'snap':
        this.onSnapshot(msg);
        break;
      case 'inv':
        this.inventory = msg.inv;
        this.markHud();
        break;
      case 'death':
        this.death = msg.d;
        this.setStatus('dead');
        break;
      case 'extracted':
        this.extracted = msg.x;
        this.setStatus('extracted');
        break;
      case 'end':
        this.end = msg.r;
        if (this.status === 'playing' || this.status === 'lobby') this.setStatus('ended');
        this.markHud();
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - msg.c);
        break;
      case 'err':
        this.fail(msg.msg);
        break;
      case 'kick':
        if (this.status === 'playing' || this.status === 'lobby' || this.status === 'connecting') this.fail(msg.reason);
        this.disposedSocket();
        break;
    }
  }

  /** Server closed us deliberately: do not auto-reconnect. */
  private disposedSocket(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private onWelcome(msg: Extract<ServerMessage, { t: 'welcome' }>): void {
    const reconnect = this.map !== null;
    this.matchId = msg.matchId;
    this.map = msg.map;
    this.world ??= new CollisionWorld(msg.map.obstacles, msg.map.width, msg.map.height);
    this.reconnectKey = msg.reconnectKey;
    this.devTools = msg.devTools;
    this.playerName = msg.name;
    this.playerId = msg.playerId;
    this.reconnectStartedAt = null;
    if (reconnect) {
      // Server resets our replication state; do the same.
      this.players.clear();
      this.items.clear();
      this.crates.clear();
      this.bullets.length = 0;
      this.pending = [];
      this.pendingShots.clear();
      this.predictedSlot = null;
      this.localReload = null;
      this.predictionReady = false;
    }
    if (msg.phase === 'WAITING' || msg.phase === 'STARTING') this.setStatus('lobby');
    else if (msg.playerId !== null) this.setStatus('playing');
    this.markHud();
  }

  private onSnapshot(s: SnapshotMessage): void {
    const now = performance.now();
    const offset = s.time - now;
    if (this.timeOffset === null || Math.abs(offset - this.timeOffset) > 1000) {
      this.timeOffset = offset;
      for (const p of this.players.values()) p.samples.splice(0, Math.max(0, p.samples.length - 1));
      for (const p of this.players.values()) if (p.samples[0]) p.samples[0].t = s.time;
    } else if (offset > this.timeOffset) {
      // Track the least-delayed packets: follow quickly upward, drift down slowly.
      // Keeps the interpolation clock stable against network jitter.
      this.timeOffset += (offset - this.timeOffset) * 0.25;
    } else {
      this.timeOffset += (offset - this.timeOffset) * 0.01;
    }
    this.lastSnapAt = s.time;

    if (s.self) this.reconcile(s.self, s.ack);

    if (s.pe) for (const e of s.pe) this.upsertPlayer(e.d, s.time, e.name, e.bot);
    if (s.pu) for (const d of s.pu) this.upsertPlayer(d, s.time);
    if (s.pl) for (const id of s.pl) this.players.delete(id);

    if (s.ie) for (const it of s.ie) this.items.set(it.id, it);
    if (s.il) for (const id of s.il) this.items.delete(id);
    if (s.ce) for (const c of s.ce) this.crates.set(c.id, c);
    if (s.cu) {
      for (const [id, opened, locked] of s.cu) {
        const c = this.crates.get(id);
        if (c) {
          c.opened = opened === 1;
          c.locked = locked === 1;
        }
      }
    }
    if (s.cl) for (const id of s.cl) this.crates.delete(id);

    if (s.bs) for (const b of s.bs) this.spawnBullet(b);
    if (s.be) for (const b of s.be) this.endBullet(b);

    if (s.g) {
      this.global = s.g;
      this.markHud();
    }
    if (s.ev) for (const ev of s.ev) this.onEvent(ev);
    this.markHud();
  }

  private reconcile(self: SelfState, ack: number): void {
    const prevBag = this.self?.bagValue;
    if (prevBag !== undefined && self.bagValue > prevBag) {
      this.bagGainAt = performance.now();
      this.bagGain = self.bagValue - prevBag;
    }
    this.trackWeaponEvents(this.self, self);
    this.self = self;
    this.lastAck = ack;
    for (const seq of this.pendingShots.keys()) if (seq <= ack) this.pendingShots.delete(seq);
    if (!this.world) return;
    if (!this.predictionReady) {
      Object.assign(this.predicted, {
        x: self.x,
        y: self.y,
        dashTime: self.dashTime,
        dashCooldown: self.dashCooldown,
        dashDirX: self.dashDirX,
        dashDirY: self.dashDirY,
      });
      this.prevX = self.x;
      this.prevY = self.y;
      this.pending = this.pending.filter((i) => i.s > ack);
      this.predictionReady = true;
      return;
    }
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.s <= ack) drop++;
    if (drop) this.pending.splice(0, drop);

    const corrected: MoveState = {
      x: self.x,
      y: self.y,
      dashTime: self.dashTime,
      dashCooldown: self.dashCooldown,
      dashDirX: self.dashDirX,
      dashDirY: self.dashDirY,
    };
    const params = moveParamsFor(this.activeDef);
    for (const cmd of this.pending) stepMovement(corrected, cmd, DT, this.world, params);
    const ex = this.predicted.x - corrected.x;
    const ey = this.predicted.y - corrected.y;
    if (ex * ex + ey * ey > 160 * 160) {
      // Teleport-sized correction (dev teleport / respawn): snap.
      this.smoothX = 0;
      this.smoothY = 0;
      this.prevX = corrected.x;
      this.prevY = corrected.y;
    } else {
      // Shift the whole interpolation segment and absorb the jump in the smoothing offset.
      this.smoothX += ex;
      this.smoothY += ey;
      this.prevX -= ex;
      this.prevY -= ey;
    }
    Object.assign(this.predicted, corrected);
  }

  /** Reload sounds / events from authoritative state changes (shell inserts, completion). */
  private trackWeaponEvents(prev: SelfState | null, next: SelfState): void {
    const w = next.weapons[next.activeSlot];
    const was = prev?.weapons[prev.activeSlot];
    const reloading = next.reloadRemainingMs > 0;
    if (reloading && !this.serverReloadActive) {
      // Server started a reload we did not predict (e.g. auto reload): announce it.
      if (!this.localReload && w) {
        this.reloadKey++;
        this.fx.push({ e: 'reloadStart', weaponId: w.weaponId, tactical: w.mag > 0 });
      }
      this.localReload = null;
    }
    if (w && was && w.uid === was.uid && w.mag > was.mag && prev && prev.reloadRemainingMs > 0) {
      const def = WEAPONS[w.weaponId];
      if (def.reloadStyle === 'SHELL') this.fx.push({ e: 'shellIn', weaponId: w.weaponId });
      if (!reloading) this.fx.push({ e: 'reloadDone', weaponId: w.weaponId });
    }
    this.serverReloadActive = reloading;
    // A predicted reload the server never confirmed (rejected / raced): drop it.
    if (this.localReload && !reloading && performance.now() - this.localReload.at > 450 + this.ping) this.localReload = null;
  }

  private upsertPlayer(d: PlayerNet, t: number, name?: string, bot?: boolean): void {
    const [id, x, y, rot100, hp, maxHp, armor, weapon, status, flags] = d;
    const rot = rot100 / 100;
    let p = this.players.get(id);
    if (!p) {
      p = { id, name: name ?? '?', bot: bot ?? false, samples: [], hp, maxHp, armor, weapon, status, flags, x, y, rot };
      this.players.set(id, p);
    }
    const last = p.samples[p.samples.length - 1];
    // After a pause (entity unchanged) re-anchor so interpolation starts now, not from the old sample.
    if (last && t - last.t > SNAP_INTERVAL * 1.5) p.samples.push({ t: t - SNAP_INTERVAL, x: last.x, y: last.y, rot: last.rot });
    p.samples.push({ t, x, y, rot });
    if (p.samples.length > 30) p.samples.splice(0, p.samples.length - 30);
    p.hp = hp;
    p.maxHp = maxHp;
    p.armor = armor;
    p.weapon = weapon;
    p.status = status;
    p.flags = flags;
  }

  private spawnBullet(b: BulletSpawn): void {
    const [id, x, y, angle1000, speed, range, weapon, ownerId] = b;
    const angle = angle1000 / 1000;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let maxDist = range;
    const hit = this.world?.raycast(x, y, x + dx * range, y + dy * range);
    if (hit) maxDist = hit.t * range;
    // Our own shots are already shown via prediction; keep the server copy invisible
    // so hit confirmations (bullet end events) still line up.
    const ghost = ownerId === this.playerId;
    const def = weaponFromIndex(weapon) ?? WEAPONS.basic_pistol;
    let tracer = true;
    if (!ghost && def.visual.tracerEvery > 1) {
      const k = (this.remoteTracerCount.get(ownerId) ?? 0) + 1;
      this.remoteTracerCount.set(ownerId, k);
      tracer = k % def.visual.tracerEvery === 0;
    }
    this.bullets.push({ id, x0: x, y0: y, dx, dy, speed, maxDist, weapon, ownerId, born: performance.now(), endDist: null, hitPlayer: false, local: false, ghost, surface: hit?.obstacle.style ?? null, tracer });
    if (this.bullets.length > 500) this.bullets.splice(0, this.bullets.length - 500);
  }

  private endBullet(e: BulletEnd): void {
    const [id, x, y, hit] = e;
    const b = this.bullets.find((bb) => bb.id === id);
    if (!b) return;
    if (hit === 2) {
      // Pierced a player and kept flying.
      this.fx.push({ e: 'pierce', x, y, dx: b.dx, dy: b.dy });
      return;
    }
    b.endDist = Math.hypot(x - b.x0, y - b.y0);
    b.hitPlayer = hit === 1;
  }

  private onEvent(ev: GameEvent): void {
    const now = performance.now();
    switch (ev.e) {
      case 'kill':
        this.feed = [
          ...this.feed.slice(-5),
          {
            id: this.uid++,
            at: now,
            text: '',
            killer: ev.killer,
            victim: ev.victim,
            weapon: ev.weapon,
            bountyCents: ev.bountyCents,
            mine: ev.killerId === this.playerId || ev.victimId === this.playerId,
            byMe: ev.killerId !== null && ev.killerId === this.playerId,
          },
        ];
        this.fx.push(ev);
        break;
      case 'announce':
        this.announcements = [...this.announcements.slice(-2), { id: this.uid++, at: now, text: ev.text, sub: ev.sub, kind: ev.kind }];
        this.fx.push(ev);
        break;
      case 'bounty':
        this.notices = [...this.notices.slice(-3), { id: this.uid++, at: now, text: `${ev.name} bounty raised` }];
        break;
      case 'loot':
        this.toasts = [...this.toasts.slice(-2), { id: this.uid++, at: now, itemId: ev.itemId, qty: ev.qty, rarity: ev.rarity, value: ev.value }];
        if (RARITY_CONFIG[ev.rarity].rank >= RARITY_CONFIG.LEGENDARY.rank) this.legendary = { id: this.uid++, at: now, itemId: ev.itemId, value: ev.value };
        this.fx.push(ev);
        break;
      case 'notice':
        this.notices = [...this.notices.slice(-3), { id: this.uid++, at: now, text: ev.text }];
        break;
      case 'extract':
        if (ev.state === 'started') {
          this.extractInterrupt = null;
          this.notices = [...this.notices.slice(-3), { id: this.uid++, at: now, text: 'Extraction started — hold position' }];
        } else {
          this.extractInterrupt = { at: now, reason: ev.reason ?? 'Interrupted' };
        }
        this.fx.push(ev);
        break;
      case 'kingpin':
        this.kingpin = { id: this.uid++, at: now, playerId: ev.playerId, name: ev.name, bagCents: ev.bagCents, self: ev.playerId === this.playerId };
        this.fx.push(ev);
        break;
      case 'extractAlert':
        this.extractAlertAt = now;
        this.fx.push(ev);
        break;
      case 'hurt':
        this.hurtAt = now;
        this.hurts = [...this.hurts.slice(-3), { id: this.uid++, at: now, angle: ev.angle, armor: ev.armor ?? false }];
        this.fx.push(ev);
        break;
      case 'dmg':
        this.fx.push(ev);
        break;
      case 'phase':
        break;
    }
    if (this.fx.length > 64) this.fx.splice(0, this.fx.length - 64);
    this.markHud();
  }

  /** Self status label from the replicated tuple index. */
  static statusName(index: number): string {
    return PLAYER_STATUSES[index] ?? 'ALIVE';
  }

  get lastSnapshotTime(): number {
    return this.lastSnapAt;
  }
}
