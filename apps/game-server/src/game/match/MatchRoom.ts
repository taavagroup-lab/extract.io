import {
  BOT_CONFIG,
  DEATH_SPILL_RADIUS,
  ITEM_DEFINITIONS,
  MATCH_CONFIG,
  NETWORK_CONFIG,
  WEAPONS,
} from '@extract/game-config';
import {
  INPUT_BUTTONS,
  type BulletEnd,
  type BulletSpawn,
  type ClientAction,
  type DeathSummary,
  type DevCommand,
  type ExtractionPointDef,
  type GameEvent,
  type InputCmd,
  type InventoryOp,
  type MapData,
  type MatchEndSummary,
  type MatchGlobalState,
  type MatchPhase,
  type RunEndReason,
  type SelfState,
  type WeaponId,
} from '@extract/game-types';
import { logEvent, type AnalyticsBus, type Logger } from '@extract/server-core';
import { Rng, dist2, stepMovement, wrapAngle } from '@extract/shared';
import { BotBrain } from '../../bots/BotBrain';
import type { NavGrid } from '../../bots/NavGrid';
import { ClientView } from '../../net/ClientView';
import { SnapshotBuilder } from '../../net/SnapshotBuilder';
import type { GamePersistence, RunOutcome } from '../../persistence/types';
import { DEATH_LOSS_OPTIONS, TIMEOUT_LOSS_OPTIONS, computeRunLoss } from '../death/deathOutcome';
import { ServerPlayer, type PlayerChannel } from '../entities/ServerPlayer';
import { matchId, secretKey } from '../ids';
import { LimitedSupplyTracker } from '../loot/lootGenerator';
import { BountySystem } from '../systems/BountySystem';
import { CombatSystem } from '../systems/CombatSystem';
import { ExtractionSystem } from '../systems/ExtractionSystem';
import { LootSystem } from '../systems/LootSystem';
import { SupplyDropSystem } from '../systems/SupplyDropSystem';
import { World, type Drop } from '../world/World';
import { MatchStateMachine } from './MatchStateMachine';

export interface MatchRoomOptions {
  map: MapData;
  nav: NavGrid;
  logger: Logger;
  analytics: AnalyticsBus;
  persistence: GamePersistence;
  targetPlayers: number;
  fillWithBots: boolean;
  /** Humans required to start when bots are disabled (default 2). */
  minHumans?: number;
  lobbyWaitMs: number;
  devTools: boolean;
  seasonId: string | null;
  seed?: number;
}

const OUTCOME: Record<RunEndReason, RunOutcome> = { killed: 'DIED', timeout: 'TIMEOUT', abandoned: 'ABANDONED' };

/**
 * One match. Owns the world, the phase state machine and all systems, and
 * runs the fixed-rate simulation. Networking reaches it only through
 * PlayerChannel + the handle* methods, so it is fully testable offline.
 */
export class MatchRoom {
  readonly id = matchId();
  readonly rng: Rng;
  readonly world: World;
  readonly logger: Logger;
  readonly analytics: AnalyticsBus;
  readonly combat: CombatSystem;
  readonly loot: LootSystem;
  readonly extraction: ExtractionSystem;
  readonly bounty: BountySystem;
  readonly supplyDrops: SupplyDropSystem;
  supply: LimitedSupplyTracker = LimitedSupplyTracker.fromDefinitions({});

  /** Every participant (humans in lobby, spawned humans and bots). */
  readonly members = new Map<number, ServerPlayer>();
  private readonly bots = new Map<number, BotBrain>();
  private readonly sm: MatchStateMachine;
  private readonly snapshots = new SnapshotBuilder();
  private readonly dtMs = 1000 / NETWORK_CONFIG.tickRate;

  /** Room clock (ms since creation). Drives cooldowns and timers. */
  now = 0;
  tickCount = 0;
  bulletSpawns: BulletSpawn[] = [];
  bulletEnds: BulletEnd[] = [];
  globalVersion = 1;
  finishedAt: number | null = null;
  readonly createdAt = Date.now();

  private globalCache: MatchGlobalState | null = null;
  private globalCacheVersion = 0;
  private highValueActive = false;
  private lobbyStartedAt: number | null = null;
  private lastLobbySent = -Infinity;
  private finalWarningSent = false;
  private humansEverJoined = 0;
  private spawnedCount = 0;
  private extraBots = 0;
  private botCounter = 0;
  private readonly phaseStarts: Partial<Record<MatchPhase, number>> = {};
  private readonly extractedList: { name: string; valueCents: number }[] = [];

  constructor(private readonly opts: MatchRoomOptions) {
    this.rng = new Rng(opts.seed);
    this.logger = opts.logger.child({ matchId: this.id });
    this.analytics = opts.analytics;
    this.world = new World(opts.map, this.rng);
    this.combat = new CombatSystem(this);
    this.loot = new LootSystem(this);
    this.extraction = new ExtractionSystem(this);
    this.bounty = new BountySystem(this);
    this.supplyDrops = new SupplyDropSystem(this);
    this.sm = new MatchStateMachine((phase, prev) => this.onPhaseEnter(phase, prev));
  }

  async init(): Promise<void> {
    this.supply = LimitedSupplyTracker.fromDefinitions(await this.opts.persistence.getLimitedSupply());
  }

  // ------------------------------------------------------------------ state

  get phase(): MatchPhase {
    return this.sm.phase;
  }
  get matchTime(): number {
    return this.sm.matchTime(this.now);
  }
  get isLobby(): boolean {
    return this.sm.isLobby;
  }
  get isActive(): boolean {
    return this.sm.isActive;
  }
  get isFinished(): boolean {
    return this.sm.isFinished;
  }
  get devTools(): boolean {
    return this.opts.devTools;
  }

  phaseStartedAt(phase: MatchPhase): number {
    return this.phaseStarts[phase] ?? Infinity;
  }

  get humanMembers(): ServerPlayer[] {
    return [...this.members.values()].filter((p) => p.isHuman);
  }

  get connectedHumans(): number {
    let n = 0;
    for (const p of this.members.values()) if (p.isHuman && p.channel) n++;
    return n;
  }

  /** Can a new human join this room right now? */
  get joinable(): boolean {
    if (this.members.size >= MATCH_CONFIG.maxPlayers) return false;
    if (this.sm.isLobby) return true;
    return this.sm.isActive && this.matchTime < MATCH_CONFIG.lateJoinWindowMs;
  }

  // ------------------------------------------------------------- membership

  addHuman(name: string, userId: string | null, channel: PlayerChannel): ServerPlayer {
    const p = new ServerPlayer(this.world.newId(), name, userId, false, secretKey(), 0, 0);
    p.channel = channel;
    p.view = new ClientView();
    this.members.set(p.id, p);
    this.humansEverJoined++;
    this.sendWelcome(p);
    if (this.sm.isActive) {
      this.spawn(p);
      channel.send({ t: 'start', playerId: p.id });
    }
    logEvent(this.logger, 'player_joined', { player: name, userId, phase: this.phase });
    return p;
  }

  /** Re-binds a returning client to its existing character (reconnect window). */
  reattach(p: ServerPlayer, channel: PlayerChannel): void {
    if (p.channel && p.channel !== channel) p.channel.close('replaced by a new connection');
    p.channel = channel;
    p.view ??= new ClientView();
    p.view.reset();
    p.inputQueue.length = 0;
    p.lastQueuedSeq = 0;
    p.lastProcessedSeq = 0;
    if (p.status === 'DISCONNECTED') {
      p.status = 'ALIVE';
      p.disconnectedAt = null;
      this.markGlobalDirty();
    }
    this.sendWelcome(p);
    if (this.world.players.has(p.id)) channel.send({ t: 'start', playerId: p.id });
    logEvent(this.logger, 'player_reconnected', { player: p.name });
  }

  handleDisconnect(p: ServerPlayer): void {
    p.channel = null;
    if (this.sm.isLobby) {
      this.members.delete(p.id);
      logEvent(this.logger, 'player_left', { player: p.name, phase: this.phase });
      return;
    }
    if (p.inWorld && !p.finished) {
      if (p.extraction) this.extraction.cancel(p, 'Disconnected');
      p.use = null;
      p.reload = null;
      p.inputQueue.length = 0;
      p.status = 'DISCONNECTED';
      p.disconnectedAt = this.now;
      this.markGlobalDirty();
      logEvent(this.logger, 'player_left', { player: p.name, reconnectWindowMs: NETWORK_CONFIG.reconnectWindowMs });
    }
  }

  /** Explicit quit: forfeits the run immediately (same rules as dying). */
  leave(p: ServerPlayer): void {
    if (this.sm.isLobby) {
      this.handleDisconnect(p);
      return;
    }
    if (p.inWorld && !p.finished) this.endRun(p, 'abandoned', null, null);
    p.channel = null;
  }

  private spawn(p: ServerPlayer): void {
    const pos = this.world.findSpawnPoint();
    p.move.x = pos.x;
    p.move.y = pos.y;
    p.status = 'ALIVE';
    p.spawnedAt = this.now;
    p.inputBudget = 0;
    this.world.players.set(p.id, p);
    this.world.playerGrid.insert(p);
    p.computeNet();
    this.spawnedCount++;
    this.markGlobalDirty();
  }

  spawnBot(): ServerPlayer {
    const names = BOT_CONFIG.names;
    const n = this.botCounter++;
    const name = n < names.length ? names[n]! : `${names[n % names.length]}${Math.floor(n / names.length) + 1}`;
    const p = new ServerPlayer(this.world.newId(), name, null, true, secretKey(), 0, 0);
    this.members.set(p.id, p);
    this.bots.set(p.id, new BotBrain(this.rng, this.opts.nav));
    this.spawn(p);
    return p;
  }

  spawnBots(count: number): number {
    const room = MATCH_CONFIG.maxPlayers - this.members.size - this.extraBots;
    const n = Math.max(0, Math.min(count, room));
    if (this.sm.isLobby) this.extraBots += n;
    else if (this.sm.isActive) for (let i = 0; i < n; i++) this.spawnBot();
    return n;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    this.tickCount++;
    this.now += this.dtMs;
    if (this.sm.isLobby) this.updateLobby();
    this.sm.update(this.now);
    if (this.sm.isActive) this.simulate(this.dtMs / 1000);
    if (this.tickCount % NETWORK_CONFIG.snapshotEveryTicks === 0) this.sendSnapshots();
  }

  private simulate(dt: number): void {
    const world = this.world;
    for (const [id, brain] of this.bots) {
      const p = world.players.get(id);
      if (p && (p.status === 'ALIVE' || p.status === 'EXTRACTING')) p.inputQueue.push(brain.update(this, p));
    }
    for (const p of world.players.values()) {
      p.accrueInputBudget(dt);
      this.processInputs(p, dt);
      this.combat.updateReload(p);
      this.loot.updateUse(p);
      world.playerGrid.update(p);
    }
    this.combat.updateBullets(dt);
    for (const p of world.players.values()) this.loot.autoPickupAmmo(p);
    this.extraction.update();
    this.supplyDrops.update();
    this.bounty.update();
    this.checkDisconnects();
    this.checkTimers();
  }

  /**
   * Consumes queued inputs within the player's time budget. A client cannot
   * move faster than real time no matter how many inputs it sends.
   */
  private processInputs(p: ServerPlayer, dt: number): void {
    const canMove = p.status === 'ALIVE' || p.status === 'EXTRACTING';
    while (p.inputQueue.length > 0 && p.inputBudget >= dt - 1e-6) {
      const input = p.inputQueue.shift()!;
      p.inputBudget -= dt;
      p.lastProcessedSeq = input.s;
      if (!canMove) continue;
      p.rotation = wrapAngle(input.a);
      stepMovement(p.move, input, dt, this.world.collision);
      if (input.b & INPUT_BUTTONS.FIRE) this.combat.tryFire(p);
    }
    // No banking while idle: otherwise a client could stay silent and then
    // burst-move. One tick of slack still absorbs normal network jitter.
    if (p.inputQueue.length === 0) p.inputBudget = Math.min(p.inputBudget, dt);
  }

  private checkDisconnects(): void {
    for (const p of this.world.players.values()) {
      if (p.status === 'DISCONNECTED' && p.disconnectedAt !== null && this.now - p.disconnectedAt >= NETWORK_CONFIG.reconnectWindowMs) {
        this.endRun(p, 'abandoned', null, null);
      }
    }
  }

  private checkTimers(): void {
    if (!this.finalWarningSent && this.matchTime >= MATCH_CONFIG.finalWarningAtMs) {
      this.finalWarningSent = true;
      this.broadcast({ e: 'announce', text: 'WARNING', sub: 'FINAL MINUTE — extract now or lose your run', kind: 'danger' });
    }
    if (this.humansEverJoined > 0) {
      let humansInWorld = false;
      for (const p of this.world.players.values()) {
        if (p.isHuman) {
          humansInWorld = true;
          break;
        }
      }
      if (!humansInWorld) this.sm.finish();
    }
  }

  // ------------------------------------------------------------------ lobby

  private lobbyFound(humans: number): number {
    const target = Math.max(humans, this.opts.targetPlayers);
    if (!this.opts.fillWithBots) return humans;
    if (this.sm.phase === 'STARTING') return target;
    const elapsed = this.lobbyStartedAt === null ? 0 : this.now - this.lobbyStartedAt;
    return humans + Math.floor((target - humans) * Math.min(1, elapsed / Math.max(1, this.opts.lobbyWaitMs)));
  }

  private updateLobby(): void {
    const humans = this.humanMembers.length;
    if (humans === 0) {
      this.lobbyStartedAt = null;
      return;
    }
    this.lobbyStartedAt ??= this.now;
    if (this.sm.phase === 'WAITING') {
      const elapsed = this.now - this.lobbyStartedAt;
      const full = humans >= this.opts.targetPlayers;
      const waited = elapsed >= this.opts.lobbyWaitMs;
      if (full || (waited && (this.opts.fillWithBots || humans >= (this.opts.minHumans ?? 2)))) this.sm.beginCountdown(this.now);
    }
    if (this.now - this.lastLobbySent >= 200) {
      this.lastLobbySent = this.now;
      const found = this.lobbyFound(humans);
      const countdown = this.sm.countdownRemaining(this.now);
      for (const p of this.members.values()) {
        p.channel?.send({
          t: 'lobby',
          phase: this.sm.phase === 'STARTING' ? 'STARTING' : 'WAITING',
          found,
          target: Math.max(humans, this.opts.targetPlayers),
          humans,
          countdownMs: countdown,
        });
      }
    }
  }

  // ----------------------------------------------------------------- phases

  private onPhaseEnter(phase: MatchPhase, _prev: MatchPhase): void {
    this.phaseStarts[phase] = this.matchTime;
    switch (phase) {
      case 'LOOT_PHASE':
        this.startMatch();
        break;
      case 'COMBAT_PHASE':
        this.highValueActive = true;
        for (const c of this.world.crates.values()) c.locked = false;
        this.broadcast({ e: 'announce', text: 'HIGH VALUE ZONE ACTIVE', sub: 'The Vault is open — better loot inside', kind: 'warning' });
        break;
      case 'EXTRACTION_PHASE':
        this.extraction.activate();
        break;
      case 'FINISHED':
        this.onFinished();
        break;
      default:
        break;
    }
    if (phase !== 'WAITING' && phase !== 'STARTING') this.broadcast({ e: 'phase', phase });
    this.markGlobalDirty();
  }

  private startMatch(): void {
    for (const p of this.members.values()) {
      if (p.finished) continue;
      this.spawn(p);
      p.channel?.send({ t: 'start', playerId: p.id });
    }
    const humans = this.humanMembers.length;
    const fill = this.opts.fillWithBots ? Math.max(0, this.opts.targetPlayers - humans) : 0;
    const total = Math.min(fill + this.extraBots, MATCH_CONFIG.maxPlayers - humans);
    for (let i = 0; i < total; i++) this.spawnBot();

    logEvent(this.logger, 'match_started', { humans, bots: this.bots.size, map: this.opts.map.id });
    this.analytics.track('MATCH_STARTED', { matchId: this.id, humans, bots: this.bots.size });
    void this.opts.persistence.matchStarted({
      matchId: this.id,
      seasonId: this.opts.seasonId,
      mapId: this.opts.map.id,
      startedAt: new Date(),
    });
    this.broadcast({ e: 'announce', text: 'LOOT PHASE', sub: 'Find weapons & loot. Extraction opens at 07:00.', kind: 'info' });
  }

  private onFinished(): void {
    for (const p of [...this.world.players.values()]) this.endRun(p, 'timeout', null, null);
    this.world.bullets.length = 0;
    const summary = this.endSummary();
    for (const p of this.members.values()) p.channel?.send({ t: 'end', r: summary });
    const humans = this.humanMembers.length;
    void this.opts.persistence.matchFinished({
      matchId: this.id,
      endedAt: new Date(),
      playerCount: humans,
      botCount: this.bots.size,
      summary: { ...summary },
    });
    logEvent(this.logger, 'match_finished', { durationMs: Math.round(this.matchTime), extracted: this.extractedList.length, humans });
    this.analytics.track('MATCH_ENDED', { matchId: this.id, durationMs: Math.round(this.matchTime), extracted: this.extractedList.length });
    this.finishedAt = this.now;
  }

  private endSummary(): MatchEndSummary {
    const top = [...this.members.values()]
      .filter((p) => p.kills > 0)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 5)
      .map((p) => ({ name: p.name, kills: p.kills }));
    return {
      matchId: this.id,
      durationMs: Math.round(this.matchTime),
      extracted: this.extractedList.slice(0, 20),
      topKills: top,
      totalPlayers: this.spawnedCount,
    };
  }

  // ---------------------------------------------------------------- events

  emitTo(p: ServerPlayer, ev: GameEvent): void {
    p.view?.push(ev);
  }

  broadcast(ev: GameEvent): void {
    for (const p of this.members.values()) p.view?.push(ev);
  }

  emitNear(x: number, y: number, radius: number, ev: GameEvent, except?: ServerPlayer): void {
    const r2 = radius * radius;
    for (const p of this.world.players.values()) {
      if (p !== except && p.view && dist2(p.x, p.y, x, y) <= r2) p.view.push(ev);
    }
  }

  markGlobalDirty(): void {
    this.globalVersion++;
  }

  globalState(): MatchGlobalState {
    if (this.globalCache && this.globalCacheVersion === this.globalVersion) return this.globalCache;
    this.globalCache = {
      matchId: this.id,
      phase: this.phase,
      timeMs: Math.round(this.matchTime),
      durationMs: MATCH_CONFIG.durationMs,
      alive: this.world.players.size,
      total: this.spawnedCount,
      highValueActive: this.highValueActive,
      extractionZones: this.extraction.toState(),
      supplyDrops: this.supplyDrops.drops.map((d) => ({ ...d })),
      bounties: this.bounty.markers,
    };
    this.globalCacheVersion = this.globalVersion;
    return this.globalCache;
  }

  selfStateFor(p: ServerPlayer): SelfState {
    const s = p.selfState(this.now);
    s.extraction = this.extraction.progressFor(p);
    return s;
  }

  // -------------------------------------------------------------- outcomes

  private removeFromWorld(p: ServerPlayer): void {
    this.world.players.delete(p.id);
    this.world.playerGrid.remove(p);
    this.extraction.forget(p);
    this.bots.delete(p.id);
  }

  killPlayer(victim: ServerPlayer, killer: ServerPlayer | null, weaponId: WeaponId | null): void {
    if (victim.finished || !victim.inWorld) return;
    let bountyClaimed = 0;
    if (killer) {
      killer.kills++;
      if (victim.bountyCents > 0) {
        bountyClaimed = victim.bountyCents;
        killer.pendingBountyCents += bountyClaimed;
        killer.bountyKills++;
      }
      this.bounty.onKill(killer);
    }
    const weaponName = weaponId ? WEAPONS[weaponId].name : null;
    this.broadcast({
      e: 'kill',
      killerId: killer?.id ?? null,
      killer: killer?.name ?? null,
      victimId: victim.id,
      victim: victim.name,
      weapon: weaponName,
      bountyCents: bountyClaimed,
    });
    if (killer?.isHuman || victim.isHuman) {
      logEvent(this.logger, 'player_killed', {
        killer: killer?.name ?? null,
        victim: victim.name,
        weapon: weaponId,
        bounty: bountyClaimed,
      });
      void this.opts.persistence.killRecorded({
        matchId: this.id,
        killerUserId: killer?.userId ?? null,
        victimUserId: victim.userId,
        killerName: killer?.name ?? null,
        victimName: victim.name,
        weaponId,
        wasBountyKill: bountyClaimed > 0,
        bountyCents: bountyClaimed,
      });
    }
    this.endRun(victim, 'killed', killer, weaponName);
  }

  /** Death, abandon (disconnect timeout / quit) or timeout at 10:00. */
  private endRun(p: ServerPlayer, reason: RunEndReason, killer: ServerPlayer | null, weaponName: string | null): void {
    if (p.finished) return;
    const x = p.x;
    const y = p.y;
    if (p.extraction) this.extraction.cancel(p, 'Run ended');
    p.status = 'DEAD';
    p.finished = true;
    p.use = null;
    p.reload = null;
    this.removeFromWorld(p);

    const inv = p.inventory;
    const loss = computeRunLoss(
      { slots: inv.slots, secure: inv.secure, weapons: inv.weapons, ammo: inv.ammo },
      reason === 'timeout' ? TIMEOUT_LOSS_OPTIONS : DEATH_LOSS_OPTIONS,
      this.rng,
    );
    if (reason !== 'timeout') {
      const drops: Drop[] = [
        ...loss.droppedItems,
        ...loss.droppedWeapons.map((w) => ({ itemId: w.itemId, qty: 1, mag: w.mag })),
        ...loss.droppedAmmo,
      ];
      this.world.scatter(drops, x, y, DEATH_SPILL_RADIUS, this.now);
    }
    this.bounty.onRemoved(p);
    this.markGlobalDirty();
    if (!p.isHuman) return;

    const survivedMs = Math.round(this.now - p.spawnedAt);
    const summary: DeathSummary = {
      reason,
      killerName: killer?.name ?? null,
      killerId: killer?.id ?? null,
      weaponName,
      kills: p.kills,
      damageDealt: Math.round(p.damageDealt),
      survivedMs,
      lootSecuredCents: loss.securedValue,
      lootLostCents: loss.lostValue,
      insuranceCents: loss.insuranceCents,
      keptItems: loss.kept,
      lostItems: [...loss.droppedItems.filter((i) => i.qty > 0), ...loss.droppedWeapons.map((w) => ({ itemId: w.itemId, qty: 1 }))],
      bountyLostCents: p.pendingBountyCents,
    };
    p.channel?.send({ t: 'death', d: summary });
    this.analytics.track('PLAYER_DIED', { matchId: this.id, userId: p.userId, reason, kills: p.kills, lostCents: loss.lostValue });
    if (p.userId) {
      void this.opts.persistence.savePlayerResult({
        matchId: this.id,
        userId: p.userId,
        seasonId: this.opts.seasonId,
        outcome: OUTCOME[reason],
        kills: p.kills,
        damageDealt: p.damageDealt,
        survivedMs,
        lootValueCents: loss.atRiskValue + loss.secureSlotValue,
        securedValueCents: loss.securedValue,
        lostValueCents: loss.lostValue,
        bountyEarnedCents: 0,
        bountyKills: p.bountyKills,
        payoutCents: loss.insuranceCents,
        items: loss.kept,
        extraction: null,
      });
    }
  }

  extractPlayer(p: ServerPlayer, zone: ExtractionPointDef): void {
    if (p.finished) return;
    p.status = 'EXTRACTED';
    p.finished = true;
    const items = p.inventory.persistableItems();
    const value = p.bagValue();
    p.extractedLootValue = value;
    this.removeFromWorld(p);
    this.bounty.onRemoved(p);
    this.markGlobalDirty();
    this.extractedList.push({ name: p.name, valueCents: value });
    if (!p.isHuman) return;

    const survivedMs = Math.round(this.now - p.spawnedAt);
    p.channel?.send({
      t: 'extracted',
      x: {
        extractionPoint: zone.name,
        items,
        valueCents: value,
        kills: p.kills,
        damageDealt: Math.round(p.damageDealt),
        survivedMs,
        bountyEarnedCents: p.pendingBountyCents,
      },
    });
    logEvent(this.logger, 'player_extracted', { player: p.name, zone: zone.id, valueCents: value, items: items.length });
    this.analytics.track('PLAYER_EXTRACTED', { matchId: this.id, userId: p.userId, valueCents: value, kills: p.kills });
    if (p.userId) {
      void this.opts.persistence.savePlayerResult({
        matchId: this.id,
        userId: p.userId,
        seasonId: this.opts.seasonId,
        outcome: 'EXTRACTED',
        kills: p.kills,
        damageDealt: p.damageDealt,
        survivedMs,
        lootValueCents: value,
        securedValueCents: value,
        lostValueCents: 0,
        bountyEarnedCents: p.pendingBountyCents,
        bountyKills: p.bountyKills,
        payoutCents: 0,
        items,
        extraction: { pointId: zone.id, valueCents: value },
      });
    }
  }

  // ------------------------------------------------------- client messages

  handleInputs(p: ServerPlayer, inputs: InputCmd[]): void {
    if (p.status !== 'ALIVE' && p.status !== 'EXTRACTING') return;
    for (const input of inputs) {
      if (input.s <= p.lastQueuedSeq) continue; // replayed / duplicated
      if (p.inputQueue.length >= NETWORK_CONFIG.input.maxQueue) {
        p.droppedInputs++;
        break;
      }
      p.lastQueuedSeq = input.s;
      p.inputQueue.push(input);
    }
  }

  handleAction(p: ServerPlayer, a: ClientAction): void {
    if (!this.sm.isActive) return;
    switch (a.k) {
      case 'reload':
        this.combat.startReload(p);
        break;
      case 'interact':
        this.loot.interact(p);
        break;
      case 'switch':
        this.combat.switchWeapon(p, a.slot);
        break;
      case 'useItem':
        this.loot.startUse(p, a.itemId);
        break;
    }
  }

  handleInventory(p: ServerPlayer, o: InventoryOp): void {
    if (!this.sm.isActive || (p.status !== 'ALIVE' && p.status !== 'EXTRACTING')) return;
    switch (o.op) {
      case 'drop':
        this.loot.dropBagSlot(p, o.slot);
        break;
      case 'secure':
        p.inventory.moveToSecure(o.slot);
        break;
      case 'unsecure':
        if (!p.inventory.moveFromSecure()) this.emitTo(p, { e: 'notice', text: 'No free bag slot' });
        break;
      case 'use':
        this.loot.useSlot(p, o.slot);
        break;
      case 'dropWeapon':
        this.loot.dropWeapon(p, o.slot);
        break;
    }
  }

  handleDev(p: ServerPlayer, cmd: DevCommand): void {
    if (!this.opts.devTools) return;
    const note = (text: string) => this.emitTo(p, { e: 'notice', text: `DEV · ${text}` });
    switch (cmd.cmd) {
      case 'spawnItem': {
        if (!p.inWorld) return;
        this.world.spawnItem({ itemId: cmd.itemId, qty: cmd.qty }, p.x + Math.cos(p.rotation) * 60, p.y + Math.sin(p.rotation) * 60, this.now);
        return note(`spawned ${cmd.qty}× ${cmd.itemId}`);
      }
      case 'spawnBots':
        return note(`${this.spawnBots(cmd.count)} bots spawned`);
      case 'damage': {
        const target = cmd.target === 'self' ? p : this.nearestOther(p);
        if (!target) return note('no target');
        this.combat.applyDamage(target, cmd.amount, target === p ? null : p, p.inventory.activeWeapon()?.weaponId ?? null, p.x, p.y);
        return note(`${cmd.amount} damage to ${target.name}`);
      }
      case 'teleport': {
        if (!p.inWorld) return;
        p.move.x = cmd.x;
        p.move.y = cmd.y;
        this.world.collision.resolveCircle(p.move, 22);
        this.world.playerGrid.update(p);
        p.inputQueue.length = 0;
        return note(`teleported to ${Math.round(p.x)}, ${Math.round(p.y)}`);
      }
      case 'activateExtraction':
        this.extraction.activate();
        return note('extraction zones activated');
      case 'setMatchTime':
        this.sm.setMatchTime(this.now, cmd.ms);
        return note(`match time set to ${Math.round(cmd.ms / 1000)}s`);
      case 'giveLegendary': {
        const pool = ITEM_DEFINITIONS.filter((d) => d.rarity === 'LEGENDARY' && d.persistable);
        const def = this.rng.pick(pool);
        this.loot.give(p, def.id, 1);
        return note(`gave ${def.name}`);
      }
      case 'heal':
        p.hp = p.maxHp;
        p.armor = 100;
        return note('healed');
      case 'endMatch':
        this.sm.finish();
        return;
    }
  }

  private nearestOther(p: ServerPlayer): ServerPlayer | null {
    let best: ServerPlayer | null = null;
    let bestD = Infinity;
    for (const o of this.world.players.values()) {
      if (o === p) continue;
      const d = dist2(p.x, p.y, o.x, o.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // ------------------------------------------------------------- networking

  private sendWelcome(p: ServerPlayer): void {
    p.channel?.send({
      t: 'welcome',
      matchId: this.id,
      playerId: this.world.players.has(p.id) ? p.id : null,
      name: p.name,
      userId: p.userId,
      map: this.opts.map,
      reconnectKey: p.reconnectKey,
      tickRate: NETWORK_CONFIG.tickRate,
      snapshotRate: NETWORK_CONFIG.tickRate / NETWORK_CONFIG.snapshotEveryTicks,
      devTools: this.opts.devTools,
      phase: this.phase,
    });
  }

  private sendSnapshots(): void {
    if (this.sm.isActive || this.sm.isFinished) {
      for (const p of this.world.players.values()) p.computeNet();
      for (const p of this.members.values()) {
        if (!p.channel || !p.view || !this.world.players.has(p.id)) continue;
        if (p.inventory.version !== p.view.inventoryVersion) {
          p.channel.send({ t: 'inv', inv: p.inventory.toState() });
          p.view.inventoryVersion = p.inventory.version;
        }
        p.channel.send(this.snapshots.build(this, p, this.bulletSpawns, this.bulletEnds));
      }
    }
    this.bulletSpawns = [];
    this.bulletEnds = [];
  }

  /** Tears down references so the room can be garbage collected. */
  dispose(reason: string): void {
    for (const p of this.members.values()) {
      p.channel?.close(reason);
      p.channel = null;
      p.view = null;
    }
    this.members.clear();
    this.bots.clear();
    this.world.players.clear();
    this.world.items.clear();
    this.world.bullets.length = 0;
  }
}
