import type { GameEvent, PlayerNet } from '@extract/game-types';

const MAX_QUEUED_EVENTS = 96;

/**
 * Per-client replication state: what this client already knows, so each
 * snapshot only carries entities that entered, changed or left its view.
 */
export class ClientView {
  readonly knownPlayers = new Map<number, PlayerNet>();
  readonly knownItems = new Set<number>();
  /** crate id -> opened*2 + locked */
  readonly knownCrates = new Map<number, number>();
  lastGlobalVersion = -1;
  inventoryVersion = -1;
  events: GameEvent[] = [];

  push(ev: GameEvent): void {
    if (this.events.length < MAX_QUEUED_EVENTS) this.events.push(ev);
  }

  drainEvents(): GameEvent[] | undefined {
    if (this.events.length === 0) return undefined;
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Forget everything (after a reconnect the client starts from scratch). */
  reset(): void {
    this.knownPlayers.clear();
    this.knownItems.clear();
    this.knownCrates.clear();
    this.lastGlobalVersion = -1;
    this.inventoryVersion = -1;
    this.events = [];
  }
}
