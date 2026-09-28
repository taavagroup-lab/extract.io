import type { Cents, EntityId } from './common';
import type { ItemId, Rarity } from './items';
import type { ContainerType } from './loot';
import type { MapData } from './map';
import type { LobbyState, MatchGlobalState, MatchPhase } from './match';
import type { DeathSummary, ExtractionSummary, InventoryState, SelfState } from './player';

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export const INPUT_BUTTONS = {
  FIRE: 1,
  DASH: 2,
} as const;

/**
 * One fixed simulation step of player input (1 / tickRate seconds).
 * mx/my are -1, 0 or 1; a = aim angle (radians); b = button bitmask.
 */
export interface InputCmd {
  s: number;
  mx: number;
  my: number;
  a: number;
  b: number;
}

export type ClientAction =
  | { k: 'reload' }
  | { k: 'interact' }
  | { k: 'switch'; slot: number }
  | { k: 'useItem'; itemId: ItemId };

export type InventoryOp =
  | { op: 'drop'; slot: number }
  | { op: 'secure'; slot: number }
  | { op: 'unsecure' }
  | { op: 'use'; slot: number }
  | { op: 'dropWeapon'; slot: number };

export type DevCommand =
  | { cmd: 'spawnItem'; itemId: ItemId; qty: number }
  | { cmd: 'spawnBots'; count: number }
  | { cmd: 'damage'; amount: number; target: 'self' | 'nearest' }
  | { cmd: 'teleport'; x: number; y: number }
  | { cmd: 'activateExtraction' }
  | { cmd: 'setMatchTime'; ms: number }
  | { cmd: 'giveLegendary' }
  | { cmd: 'heal' }
  | { cmd: 'endMatch' };

export type ClientMessage =
  | { t: 'join'; token: string | null; name?: string; reconnectKey?: string | null }
  | { t: 'input'; i: InputCmd[] }
  | { t: 'act'; a: ClientAction }
  | { t: 'inv'; o: InventoryOp }
  | { t: 'ping'; c: number }
  | { t: 'dev'; d: DevCommand }
  | { t: 'leave' };

// ---------------------------------------------------------------------------
// Server -> Client (compact wire shapes)
// ---------------------------------------------------------------------------

/**
 * Player network tuple:
 * [id, x, y, rot*100, hp, maxHp, armor, weaponIndex(-1 none), statusIndex, flags]
 * flags: 1 = bounty target, 2 = extracting, 4 = using item, 8 = reloading, 16 = disconnected, 32 = kingpin
 */
export type PlayerNet = [number, number, number, number, number, number, number, number, number, number];

export const PLAYER_FLAGS = {
  BOUNTY: 1,
  EXTRACTING: 2,
  USING_ITEM: 4,
  RELOADING: 8,
  DISCONNECTED: 16,
  /** Carries a KINGPIN-tier bag (see THREAT_CONFIG). */
  KINGPIN: 32,
} as const;

export interface PlayerEnter {
  name: string;
  bot: boolean;
  d: PlayerNet;
}

export interface GroundItemView {
  id: EntityId;
  x: number;
  y: number;
  itemId: ItemId;
  qty: number;
}

export interface CrateView {
  id: EntityId;
  x: number;
  y: number;
  type: ContainerType;
  opened: boolean;
  locked: boolean;
}

/** [id, opened 0/1, locked 0/1] */
export type CrateUpdate = [number, number, number];

/** [id, x, y, angle*1000, speed, range, weaponIndex, ownerId] */
export type BulletSpawn = [number, number, number, number, number, number, number, number];

/** [id, x, y, hitPlayer 0/1] */
export type BulletEnd = [number, number, number, number];

export type AnnouncementKind = 'info' | 'warning' | 'danger' | 'success';

export type GameEvent =
  | {
      e: 'kill';
      killerId: EntityId | null;
      killer: string | null;
      victimId: EntityId;
      victim: string;
      weapon: string | null;
      bountyCents: Cents;
    }
  | { e: 'phase'; phase: MatchPhase }
  | { e: 'announce'; text: string; sub?: string; kind: AnnouncementKind }
  | { e: 'loot'; itemId: ItemId; qty: number; rarity: Rarity; value: Cents }
  | { e: 'dmg'; targetId: EntityId; amount: number; x: number; y: number; armor: boolean }
  | { e: 'hurt'; amount: number; angle: number }
  | { e: 'extractAlert'; zoneId: string; x: number; y: number }
  | { e: 'extract'; state: 'started' | 'cancelled'; zoneId: string; reason?: string }
  | { e: 'notice'; text: string }
  | { e: 'bounty'; name: string; bountyCents: Cents }
  /** Someone's bag reached the KINGPIN tier (value is server authoritative). */
  | { e: 'kingpin'; playerId: EntityId; name: string; bagCents: Cents };

export interface SnapshotMessage {
  t: 'snap';
  tick: number;
  /** Match time in ms. */
  time: number;
  /** Last input sequence processed for this client. */
  ack: number;
  self: SelfState | null;
  /** Players entering the interest area (full). */
  pe?: PlayerEnter[];
  /** Changed players (full tuple, only when something changed). */
  pu?: PlayerNet[];
  /** Players leaving the interest area. */
  pl?: EntityId[];
  ie?: GroundItemView[];
  il?: EntityId[];
  ce?: CrateView[];
  cu?: CrateUpdate[];
  cl?: EntityId[];
  bs?: BulletSpawn[];
  be?: BulletEnd[];
  /** Global match state, only when its version changed. */
  g?: MatchGlobalState;
  ev?: GameEvent[];
}

export interface WelcomeMessage {
  t: 'welcome';
  matchId: string;
  playerId: EntityId | null;
  name: string;
  userId: string | null;
  map: MapData;
  reconnectKey: string;
  tickRate: number;
  snapshotRate: number;
  devTools: boolean;
  phase: MatchPhase;
}

export interface MatchEndSummary {
  matchId: string;
  durationMs: number;
  extracted: { name: string; valueCents: Cents }[];
  topKills: { name: string; kills: number }[];
  totalPlayers: number;
}

export type ServerMessage =
  | WelcomeMessage
  | ({ t: 'lobby' } & LobbyState)
  | { t: 'start'; playerId: EntityId }
  | SnapshotMessage
  | { t: 'inv'; inv: InventoryState }
  | { t: 'death'; d: DeathSummary }
  | { t: 'extracted'; x: ExtractionSummary }
  | { t: 'end'; r: MatchEndSummary }
  | { t: 'pong'; c: number; s: number }
  | { t: 'err'; code: string; msg: string }
  | { t: 'kick'; reason: string };

/** Spec alias. */
export type NetworkMessages = ClientMessage | ServerMessage;
