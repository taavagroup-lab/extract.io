import { NETWORK_CONFIG, PLAYER_CONFIG, WEAPONS, weaponIndex } from '@extract/game-config';
import {
  PLAYER_FLAGS,
  PLAYER_STATUSES,
  type InputCmd,
  type ItemId,
  type PlayerNet,
  type PlayerState,
  type PlayerStatus,
  type SelfState,
  type ServerMessage,
} from '@extract/game-types';
import type { MoveState } from '@extract/shared';
import { RaidInventory } from '../inventory/RaidInventory';
import type { ClientView } from '../../net/ClientView';

/** Transport-agnostic outbound channel for a connected human. */
export interface PlayerChannel {
  readonly connectionId: number;
  send(msg: ServerMessage): void;
  close(reason: string): void;
}

export interface TimedUse {
  itemId: ItemId;
  endsAt: number;
  totalMs: number;
}

export interface ExtractionAttempt {
  zoneId: string;
  startedAt: number;
}

/** Statuses in which the character physically exists in the world. */
export const IN_WORLD: ReadonlySet<PlayerStatus> = new Set(['ALIVE', 'EXTRACTING', 'DISCONNECTED']);

export class ServerPlayer {
  readonly move: MoveState;
  rotation = 0;
  hp: number = PLAYER_CONFIG.startHealth;
  maxHp: number = PLAYER_CONFIG.maxHealth;
  armor: number = PLAYER_CONFIG.startArmor;
  status: PlayerStatus = 'ALIVE';
  inventory: RaidInventory = RaidInventory.starter();

  kills = 0;
  damageDealt = 0;
  bountyCents = 0;
  pendingBountyCents = 0;
  bountyKills = 0;
  extractedLootValue = 0;
  /** Bag currently at the KINGPIN threat tier (maintained by KingpinSystem). */
  kingpin = false;

  nextFireAt = 0;
  reload: { slot: number; endsAt: number; totalMs: number } | null = null;
  use: TimedUse | null = null;
  extraction: ExtractionAttempt | null = null;
  lastDamagedAt = -Infinity;
  lastAttackerId: number | null = null;

  /** Queued, validated inputs awaiting simulation. */
  readonly inputQueue: InputCmd[] = [];
  /** Simulated seconds this client is allowed to consume (anti speed-hack). */
  inputBudget = 0;
  lastQueuedSeq = 0;
  lastProcessedSeq = 0;
  droppedInputs = 0;

  spawnedAt = 0;
  disconnectedAt: number | null = null;
  channel: PlayerChannel | null = null;
  view: ClientView | null = null;
  /** Result already produced (death / extraction / timeout). */
  finished = false;
  /** Cached network tuple for the current snapshot tick. */
  net: PlayerNet | null = null;

  constructor(
    readonly id: number,
    readonly name: string,
    readonly userId: string | null,
    readonly isBot: boolean,
    readonly reconnectKey: string,
    x: number,
    y: number,
  ) {
    this.move = { x, y, dashTime: 0, dashCooldown: 0, dashDirX: 0, dashDirY: 0 };
  }

  get x(): number {
    return this.move.x;
  }
  get y(): number {
    return this.move.y;
  }

  get inWorld(): boolean {
    return IN_WORLD.has(this.status);
  }

  get isHuman(): boolean {
    return !this.isBot;
  }

  bagValue(): number {
    return this.inventory.value();
  }

  computeNet(): PlayerNet {
    let flags = 0;
    if (this.bountyCents > 0) flags |= PLAYER_FLAGS.BOUNTY;
    if (this.status === 'EXTRACTING') flags |= PLAYER_FLAGS.EXTRACTING;
    if (this.use) flags |= PLAYER_FLAGS.USING_ITEM;
    if (this.reload) flags |= PLAYER_FLAGS.RELOADING;
    if (this.status === 'DISCONNECTED') flags |= PLAYER_FLAGS.DISCONNECTED;
    if (this.kingpin) flags |= PLAYER_FLAGS.KINGPIN;
    const weapon = this.inventory.activeWeapon();
    this.net = [
      this.id,
      Math.round(this.move.x * 10) / 10,
      Math.round(this.move.y * 10) / 10,
      Math.round(this.rotation * 100),
      Math.ceil(this.hp),
      this.maxHp,
      Math.ceil(this.armor),
      weaponIndex(weapon?.weaponId),
      PLAYER_STATUSES.indexOf(this.status),
      flags,
    ];
    return this.net;
  }

  selfState(now: number): SelfState {
    const inv = this.inventory;
    return {
      id: this.id,
      x: this.move.x,
      y: this.move.y,
      dashTime: this.move.dashTime,
      dashCooldown: this.move.dashCooldown,
      dashDirX: this.move.dashDirX,
      dashDirY: this.move.dashDirY,
      hp: Math.ceil(this.hp),
      maxHp: this.maxHp,
      armor: Math.ceil(this.armor),
      status: this.status,
      activeSlot: inv.activeSlot,
      weapons: inv.weapons.map((w) => (w ? { ...w } : null)),
      ammo: { ...inv.ammo },
      reloadRemainingMs: this.reload ? Math.max(0, this.reload.endsAt - now) : 0,
      reloadTotalMs: this.reload?.totalMs ?? 0,
      useItem: this.use ? { itemId: this.use.itemId, remainingMs: Math.max(0, this.use.endsAt - now), totalMs: this.use.totalMs } : null,
      kills: this.kills,
      damageDealt: Math.round(this.damageDealt),
      bagValue: this.bagValue(),
      bountyCents: this.bountyCents,
      pendingBountyCents: this.pendingBountyCents,
      extraction: null,
    };
  }

  /** Spec-shaped view of the character (used by dev tools / debugging). */
  toPlayerState(): PlayerState {
    const weapon = this.inventory.activeWeapon();
    return {
      id: this.id,
      userId: this.userId,
      name: this.name,
      isBot: this.isBot,
      status: this.status,
      position: { x: this.move.x, y: this.move.y },
      rotation: this.rotation,
      health: this.hp,
      maxHealth: this.maxHp,
      armor: this.armor,
      movementSpeed: PLAYER_CONFIG.movementSpeed,
      dashCooldown: this.move.dashCooldown,
      inventory: this.inventory.toState(),
      weapons: this.inventory.weapons,
      equippedWeapon: weapon,
      ammo: { ...this.inventory.ammo },
      kills: this.kills,
      extractedLootValue: this.extractedLootValue,
      currentBagValue: this.bagValue(),
    };
  }

  /** Accrues simulation budget for one server tick. */
  accrueInputBudget(dtSeconds: number): void {
    this.inputBudget = Math.min(this.inputBudget + dtSeconds, NETWORK_CONFIG.input.maxBudgetMs / 1000);
  }

  activeWeaponDef() {
    const w = this.inventory.activeWeapon();
    return w ? WEAPONS[w.weaponId] : null;
  }
}
