import {
  LEGENDARY_LOG_MIN_RARITY,
  LOOT_SPILL_RADIUS,
  LOOT_TOAST_MIN_RARITY,
  PLAYER_CONFIG,
  RARITY_CONFIG,
  getItemDef,
} from '@extract/game-config';
import type { ItemId } from '@extract/game-types';
import { logEvent } from '@extract/server-core';
import { dist2 } from '@extract/shared';
import type { ServerPlayer } from '../entities/ServerPlayer';
import type { Crate, GroundItem } from '../entities/types';
import { createWeapon } from '../inventory/RaidInventory';
import { rollContainerLoot } from '../loot/lootGenerator';
import type { MatchRoom } from '../match/MatchRoom';

/**
 * Containers, ground items, pickups, drops and consumables. Every request is
 * re-validated against server state (existence, distance, capacity).
 */
export class LootSystem {
  private readonly itemBuf: GroundItem[] = [];
  private readonly crateBuf: Crate[] = [];

  constructor(private readonly room: MatchRoom) {}

  private canAct(p: ServerPlayer): boolean {
    return p.status === 'ALIVE' || p.status === 'EXTRACTING';
  }

  /** E: pick up the nearest item or open the nearest crate within reach. */
  interact(p: ServerPlayer): void {
    if (!this.canAct(p)) return;
    const range = PLAYER_CONFIG.interactRange;
    const world = this.room.world;

    this.itemBuf.length = 0;
    world.itemGrid.queryRadius(p.x, p.y, range, this.itemBuf);
    let item: GroundItem | null = null;
    let itemD = Infinity;
    for (const it of this.itemBuf) {
      const d = dist2(p.x, p.y, it.x, it.y);
      if (d < itemD) {
        itemD = d;
        item = it;
      }
    }

    this.crateBuf.length = 0;
    world.crateGrid.queryRadius(p.x, p.y, range, this.crateBuf);
    let crate: Crate | null = null;
    let crateD = Infinity;
    for (const c of this.crateBuf) {
      if (c.opened) continue;
      const d = dist2(p.x, p.y, c.x, c.y);
      if (d < crateD) {
        crateD = d;
        crate = c;
      }
    }

    if (item && itemD <= crateD) this.pickup(p, item);
    else if (crate) this.openCrate(p, crate);
  }

  openCrate(p: ServerPlayer, crate: Crate): void {
    if (crate.opened) return;
    if (dist2(p.x, p.y, crate.x, crate.y) > PLAYER_CONFIG.interactRange ** 2) return;
    if (crate.locked) {
      this.room.emitTo(p, { e: 'notice', text: 'Locked until the COMBAT PHASE' });
      return;
    }
    crate.opened = true;
    const drops = rollContainerLoot(crate.type, { rng: this.room.rng, zone: crate.zone, supply: this.room.supply });
    this.room.world.scatter(drops, crate.x, crate.y, LOOT_SPILL_RADIUS, this.room.now);
    if (crate.supplyDropId !== undefined) this.room.supplyDrops.markOpened(crate.supplyDropId);
  }

  pickup(p: ServerPlayer, item: GroundItem): void {
    const world = this.room.world;
    if (!world.items.has(item.id)) return; // already taken
    if (dist2(p.x, p.y, item.x, item.y) > PLAYER_CONFIG.interactRange ** 2) return;
    const def = getItemDef(item.itemId);

    if (def.type === 'WEAPON') {
      world.removeItem(item);
      const { replaced } = p.inventory.equipWeapon(createWeapon(item.itemId, item.mag));
      p.reload = null;
      p.use = null;
      if (replaced) world.spawnItem({ itemId: replaced.itemId, qty: 1, mag: replaced.mag }, p.x, p.y, this.room.now);
      this.onLooted(p, item.itemId, 1);
      return;
    }

    const res = p.inventory.addItem(item.itemId, item.qty);
    if (res.added === 0) {
      this.room.emitTo(p, { e: 'notice', text: def.type === 'AMMO' ? 'Ammo pouch full' : 'Inventory full' });
      return;
    }
    world.removeItem(item);
    if (res.remaining > 0) world.spawnItem({ itemId: item.itemId, qty: res.remaining }, item.x, item.y, this.room.now);
    this.onLooted(p, item.itemId, res.added);
  }

  autoPickupAmmo(p: ServerPlayer): void {
    if (!this.canAct(p)) return;
    this.itemBuf.length = 0;
    this.room.world.itemGrid.queryRadius(p.x, p.y, PLAYER_CONFIG.autoPickupRange, this.itemBuf);
    for (const it of this.itemBuf) {
      const def = getItemDef(it.itemId);
      if (def.type !== 'AMMO' || !def.metadata.ammoType) continue;
      if (p.inventory.ammo[def.metadata.ammoType] >= PLAYER_CONFIG.maxAmmo[def.metadata.ammoType]) continue;
      this.pickup(p, it);
    }
  }

  private onLooted(p: ServerPlayer, itemId: ItemId, qty: number): void {
    const def = getItemDef(itemId);
    const rank = RARITY_CONFIG[def.rarity].rank;
    const value = def.estimatedValue * qty;
    if (rank >= RARITY_CONFIG[LOOT_TOAST_MIN_RARITY].rank && value > 0) {
      this.room.emitTo(p, { e: 'loot', itemId, qty, rarity: def.rarity, value });
    }
    if (p.isBot) return;
    logEvent(this.room.logger, 'item_looted', { matchId: this.room.id, player: p.name, itemId, qty, value });
    if (rank >= RARITY_CONFIG[LEGENDARY_LOG_MIN_RARITY].rank) {
      logEvent(this.room.logger, 'legendary_found', { matchId: this.room.id, player: p.name, itemId, rarity: def.rarity });
    }
    this.room.analytics.track('ITEM_FOUND', { matchId: this.room.id, userId: p.userId, itemId, rarity: def.rarity, qty });
  }

  private dropPoint(p: ServerPlayer): { x: number; y: number } {
    return { x: p.x + Math.cos(p.rotation) * 36, y: p.y + Math.sin(p.rotation) * 36 };
  }

  dropBagSlot(p: ServerPlayer, slot: number): void {
    if (!this.canAct(p)) return;
    const stack = p.inventory.removeFromSlot(slot);
    if (!stack) return;
    const at = this.dropPoint(p);
    this.room.world.spawnItem({ itemId: stack.itemId, qty: stack.qty }, at.x, at.y, this.room.now);
  }

  dropWeapon(p: ServerPlayer, slot: number): void {
    if (!this.canAct(p)) return;
    const w = p.inventory.removeWeapon(slot);
    if (!w) return;
    if (p.reload?.slot === slot) p.reload = null;
    const at = this.dropPoint(p);
    this.room.world.spawnItem({ itemId: w.itemId, qty: 1, mag: w.mag }, at.x, at.y, this.room.now);
    if (slot === p.inventory.activeSlot) {
      const next = p.inventory.weapons.findIndex((x) => x !== null);
      if (next >= 0) p.inventory.activeSlot = next;
    }
  }

  /** Starts using a consumable from the bag (medkit / armor plate). */
  startUse(p: ServerPlayer, itemId: ItemId): void {
    if (!this.canAct(p) || p.use) return;
    const def = getItemDef(itemId);
    if (def.type !== 'CONSUMABLE' || p.inventory.countInBag(itemId) <= 0) return;
    if (def.metadata.heal && p.hp >= p.maxHp) {
      this.room.emitTo(p, { e: 'notice', text: 'Health is full' });
      return;
    }
    if (def.metadata.armor && p.armor >= PLAYER_CONFIG.maxArmor) {
      this.room.emitTo(p, { e: 'notice', text: 'Armor is full' });
      return;
    }
    const totalMs = def.metadata.useTimeMs ?? 1000;
    p.reload = null;
    p.use = { itemId, endsAt: this.room.now + totalMs, totalMs };
  }

  useSlot(p: ServerPlayer, slot: number): void {
    const stack = p.inventory.slots[slot];
    if (stack) this.startUse(p, stack.itemId);
  }

  updateUse(p: ServerPlayer): void {
    const use = p.use;
    if (!use || this.room.now < use.endsAt) return;
    p.use = null;
    if (!this.canAct(p) || !p.inventory.consumeFromBag(use.itemId, 1)) return;
    const def = getItemDef(use.itemId);
    if (def.metadata.heal) p.hp = Math.min(p.maxHp, p.hp + def.metadata.heal);
    if (def.metadata.armor) p.armor = Math.min(PLAYER_CONFIG.maxArmor, p.armor + def.metadata.armor);
  }

  /** Adds an item straight into the player's inventory (dev tools). Falls back to the ground. */
  give(p: ServerPlayer, itemId: ItemId, qty: number): void {
    const def = getItemDef(itemId);
    if (def.type === 'WEAPON') {
      const { replaced } = p.inventory.equipWeapon(createWeapon(itemId));
      if (replaced) this.room.world.spawnItem({ itemId: replaced.itemId, qty: 1, mag: replaced.mag }, p.x, p.y, this.room.now);
      this.onLooted(p, itemId, 1);
      return;
    }
    const res = p.inventory.addItem(itemId, qty);
    if (res.added > 0) this.onLooted(p, itemId, res.added);
    if (res.remaining > 0) this.room.world.spawnItem({ itemId, qty: res.remaining }, p.x, p.y, this.room.now);
  }
}
