import { NETWORK_CONFIG, PLAYER_CONFIG, getItemDef } from '@extract/game-config';
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
  type PlayerNet,
  type SelfState,
  type ServerMessage,
  type SnapshotMessage,
} from '@extract/game-types';
import { CollisionWorld, decodeMessage, encodeMessage, lerp, lerpAngle, stepMovement, type MoveState } from '@extract/shared';

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
  interactHint: string | null;
  death: DeathSummary | null;
  extracted: ExtractionSummary | null;
  end: MatchEndSummary | null;
  ping: number;
  devTools: boolean;
  playerName: string;
  hurtAt: number;
}

export type FxEvent = Extract<GameEvent, { e: 'dmg' } | { e: 'hurt' } | { e: 'extractAlert' }>;

const DT = 1 / NETWORK_CONFIG.tickRate;
const DT_MS = 1000 / NETWORK_CONFIG.tickRate;
const SNAP_INTERVAL = DT_MS * NETWORK_CONFIG.snapshotEveryTicks;
const RECONNECT_ATTEMPT_MS = 1500;
const RECONNECT_GIVE_UP_MS = NETWORK_CONFIG.reconnectWindowMs - 2000;

function gameServerUrl(): string {
  const env = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (env) return env;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

/**
 * Networking + client-side simulation. Renders nothing itself: the Phaser
 * scene reads positions from here, React reads `hud`.
 *
 * - Fixed 30 Hz input steps, predicted locally with the shared movement code.
 * - Server snapshots acknowledge input sequence numbers; unacknowledged
 *   inputs are replayed on top of the authoritative state (reconciliation).
 * - Remote players are interpolated ~110 ms in the past.
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
  aim = 0;

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
  private interactHint: string | null = null;
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
    const lens = this.feed.length + this.announcements.length + this.toasts.length + this.notices.length;
    this.feed = expire(this.feed, 7000);
    this.announcements = expire(this.announcements, 4200);
    this.toasts = expire(this.toasts, 3600);
    this.notices = expire(this.notices, 2600);
    if (lens !== this.feed.length + this.announcements.length + this.toasts.length + this.notices.length) this.hudDirty = true;
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
    };
  }

  // ------------------------------------------------------------- commands

  queueDash(): void {
    this.dashQueued = true;
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

  /** Self position to render (prediction + decaying correction offset). */
  get renderX(): number {
    return this.predicted.x + this.smoothX;
  }
  get renderY(): number {
    return this.predicted.y + this.smoothY;
  }

  update(frameMs: number, input: InputSample): void {
    this.aim = input.aim;
    this.accumulator += Math.min(frameMs, 250);
    const out: InputCmd[] = [];
    while (this.accumulator >= DT_MS) {
      this.accumulator -= DT_MS;
      if (!this.canPredict) {
        this.dashQueued = false;
        continue;
      }
      let b = 0;
      if (input.fire) b |= INPUT_BUTTONS.FIRE;
      if (this.dashQueued) {
        b |= INPUT_BUTTONS.DASH;
        this.dashQueued = false;
      }
      const cmd: InputCmd = { s: ++this.seq, mx: input.mx, my: input.my, a: Math.round(input.aim * 1000) / 1000, b };
      stepMovement(this.predicted, cmd, DT, this.world!);
      this.pending.push(cmd);
      out.push(cmd);
    }
    for (let i = 0; i < out.length; i += NETWORK_CONFIG.input.maxBatch) {
      this.send({ t: 'input', i: out.slice(i, i + NETWORK_CONFIG.input.maxBatch) });
    }
    if (this.pending.length > 90) this.pending.splice(0, this.pending.length - 90);

    const decay = Math.exp(-frameMs / 60);
    this.smoothX *= decay;
    this.smoothY *= decay;

    this.interpolateRemotes();
    this.updateInteractHint();
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
        p.x = b.x;
        p.y = b.y;
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
    let hint: string | null = null;
    if (this.canPredict) {
      const r2 = PLAYER_CONFIG.interactRange ** 2;
      let best = Infinity;
      const px = this.predicted.x;
      const py = this.predicted.y;
      for (const it of this.items.values()) {
        const d = (it.x - px) ** 2 + (it.y - py) ** 2;
        if (d < r2 && d < best) {
          best = d;
          const def = getItemDef(it.itemId);
          hint = `Pick up ${def.name}${it.qty > 1 ? ` ×${it.qty}` : ''}`;
        }
      }
      for (const c of this.crates.values()) {
        if (c.opened) continue;
        const d = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (d < r2 && d < best) {
          best = d;
          const label = c.type === 'SUPPLY_DROP' ? 'Supply Drop' : `${c.type.charAt(0)}${c.type.slice(1).toLowerCase()} Crate`;
          hint = c.locked ? `${label} · locked until Combat Phase` : `Open ${label}`;
        }
      }
    }
    if (hint !== this.interactHint) {
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
    } else {
      this.timeOffset += (offset - this.timeOffset) * 0.05;
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
    this.self = self;
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
    for (const cmd of this.pending) stepMovement(corrected, cmd, DT, this.world);
    const ex = this.predicted.x - corrected.x;
    const ey = this.predicted.y - corrected.y;
    if (ex * ex + ey * ey > 160 * 160) {
      // Teleport-sized correction (dev teleport / respawn): snap.
      this.smoothX = 0;
      this.smoothY = 0;
    } else {
      this.smoothX += ex;
      this.smoothY += ey;
    }
    Object.assign(this.predicted, corrected);
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
    this.bullets.push({ id, x0: x, y0: y, dx, dy, speed, maxDist, weapon, ownerId, born: performance.now(), endDist: null, hitPlayer: false });
    if (this.bullets.length > 400) this.bullets.splice(0, this.bullets.length - 400);
  }

  private endBullet(e: BulletEnd): void {
    const [id, x, y, hitPlayer] = e;
    const b = this.bullets.find((bb) => bb.id === id);
    if (!b) return;
    b.endDist = Math.hypot(x - b.x0, y - b.y0);
    b.hitPlayer = hitPlayer === 1;
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
          },
        ];
        break;
      case 'announce':
        this.announcements = [...this.announcements.slice(-2), { id: this.uid++, at: now, text: ev.text, sub: ev.sub, kind: ev.kind }];
        break;
      case 'bounty':
        this.notices = [...this.notices.slice(-3), { id: this.uid++, at: now, text: `${ev.name} bounty raised` }];
        break;
      case 'loot':
        this.toasts = [...this.toasts.slice(-2), { id: this.uid++, at: now, itemId: ev.itemId, qty: ev.qty, rarity: ev.rarity, value: ev.value }];
        break;
      case 'notice':
        this.notices = [...this.notices.slice(-3), { id: this.uid++, at: now, text: ev.text }];
        break;
      case 'extract':
        this.notices = [
          ...this.notices.slice(-3),
          { id: this.uid++, at: now, text: ev.state === 'started' ? 'Extraction started — hold position' : `Extraction cancelled · ${ev.reason ?? ''}` },
        ];
        break;
      case 'extractAlert':
        this.extractAlertAt = now;
        this.fx.push(ev);
        break;
      case 'hurt':
        this.hurtAt = now;
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
