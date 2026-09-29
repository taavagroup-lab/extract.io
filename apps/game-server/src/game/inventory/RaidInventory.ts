import { PLAYER_CONFIG, STARTER_WEAPON_ITEM, WEAPONS, getItemDef, isWeaponId } from '@extract/game-config';
import type {
  AmmoReserves,
  AmmoType,
  InventoryState,
  ItemAmount,
  ItemId,
  ItemStack,
  WeaponInstance,
} from '@extract/game-types';
import { carriedValue } from '@extract/shared';
import { uid } from '../ids';

export interface AddResult {
  added: number;
  remaining: number;
}

export function createWeapon(itemId: ItemId, mag?: number): WeaponInstance {
  const def = getItemDef(itemId);
  const weaponId = def.metadata.weaponId;
  if (!isWeaponId(weaponId)) throw new Error(`${itemId} is not a weapon`);
  const size = WEAPONS[weaponId].magazineSize;
  return { uid: uid(), itemId, weaponId, mag: Math.max(0, Math.min(size, mag ?? size)) };
}

/**
 * In-raid inventory: 20 bag slots, 1 secure slot, 3 weapon slots and ammo
 * reserves. Server-only; every mutation is validated here.
 */
export class RaidInventory {
  readonly slots: (ItemStack | null)[];
  secure: ItemStack | null = null;
  readonly weapons: (WeaponInstance | null)[];
  activeSlot = 0;
  readonly ammo: AmmoReserves;
  /** Incremented on every bag / secure change so the network layer can sync lazily. */
  version = 0;

  constructor(bagSlots: number = PLAYER_CONFIG.bagSlots, weaponSlots: number = PLAYER_CONFIG.weaponSlots) {
    this.slots = Array.from({ length: bagSlots }, () => null);
    this.weapons = Array.from({ length: weaponSlots }, () => null);
    this.ammo = { light: 0, rifle: 0, shell: 0, heavy: 0 };
  }

  static starter(): RaidInventory {
    const inv = new RaidInventory();
    inv.weapons[0] = createWeapon(STARTER_WEAPON_ITEM);
    Object.assign(inv.ammo, PLAYER_CONFIG.startAmmo);
    return inv;
  }

  private touch(): void {
    this.version++;
  }

  activeWeapon(): WeaponInstance | null {
    return this.weapons[this.activeSlot] ?? null;
  }

  /** How many units of `itemId` fit into the bag right now. */
  capacityFor(itemId: ItemId): number {
    const def = getItemDef(itemId);
    let cap = 0;
    for (const s of this.slots) {
      if (s === null) cap += def.maxStack;
      else if (def.stackable && s.itemId === itemId) cap += Math.max(0, def.maxStack - s.qty);
    }
    return cap;
  }

  /** Adds bag items (not weapons / ammo): tops up existing stacks first, then empty slots. */
  addItem(itemId: ItemId, qty: number): AddResult {
    const def = getItemDef(itemId);
    if (def.type === 'AMMO' && def.metadata.ammoType) return this.addAmmo(def.metadata.ammoType, qty);
    if (def.type === 'WEAPON') throw new Error('Use equipWeapon for weapons');
    let remaining = Math.max(0, Math.floor(qty));
    if (def.stackable) {
      for (const s of this.slots) {
        if (remaining === 0) break;
        if (s && s.itemId === itemId && s.qty < def.maxStack) {
          const take = Math.min(remaining, def.maxStack - s.qty);
          s.qty += take;
          remaining -= take;
        }
      }
    }
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (this.slots[i] !== null) continue;
      const take = def.stackable ? Math.min(remaining, def.maxStack) : 1;
      this.slots[i] = { uid: uid(), itemId, qty: take };
      remaining -= take;
    }
    const added = Math.floor(qty) - remaining;
    if (added > 0) this.touch();
    return { added, remaining };
  }

  addAmmo(type: AmmoType, qty: number): AddResult {
    const max = PLAYER_CONFIG.maxAmmo[type];
    const take = Math.max(0, Math.min(Math.floor(qty), max - this.ammo[type]));
    this.ammo[type] += take;
    return { added: take, remaining: Math.floor(qty) - take };
  }

  removeFromSlot(slot: number): ItemStack | null {
    const stack = this.slots[slot] ?? null;
    if (!stack) return null;
    this.slots[slot] = null;
    this.touch();
    return stack;
  }

  countInBag(itemId: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s && s.itemId === itemId) n += s.qty;
    return n;
  }

  /** Consumes from the bag only (the secure slot is never consumed implicitly). */
  consumeFromBag(itemId: ItemId, qty = 1): boolean {
    if (this.countInBag(itemId) < qty) return false;
    let left = qty;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.itemId !== itemId) continue;
      const take = Math.min(left, s.qty);
      s.qty -= take;
      left -= take;
      if (s.qty === 0) this.slots[i] = null;
    }
    this.touch();
    return true;
  }

  /** Moves a bag stack into the secure slot, swapping with whatever was there. */
  moveToSecure(slot: number): boolean {
    const stack = this.slots[slot];
    if (!stack) return false;
    this.slots[slot] = this.secure;
    this.secure = stack;
    this.touch();
    return true;
  }

  moveFromSecure(): boolean {
    if (!this.secure) return false;
    const free = this.slots.indexOf(null);
    if (free < 0) return false;
    this.slots[free] = this.secure;
    this.secure = null;
    this.touch();
    return true;
  }

  /**
   * Puts a weapon into the first free weapon slot, or replaces the active
   * one (returned so the caller can drop it). Auto-equips the new weapon.
   */
  equipWeapon(weapon: WeaponInstance): { slot: number; replaced: WeaponInstance | null } {
    let slot = this.weapons.indexOf(null);
    let replaced: WeaponInstance | null = null;
    if (slot < 0) {
      slot = this.activeSlot;
      replaced = this.weapons[slot] ?? null;
    }
    this.weapons[slot] = weapon;
    this.activeSlot = slot;
    return { slot, replaced };
  }

  removeWeapon(slot: number): WeaponInstance | null {
    const w = this.weapons[slot] ?? null;
    this.weapons[slot] = null;
    return w;
  }

  value(): number {
    return carriedValue(this.slots, this.secure, this.weapons);
  }

  toState(): InventoryState {
    return {
      slots: this.slots.map((s) => (s ? { ...s } : null)),
      secure: this.secure ? { ...this.secure } : null,
    };
  }

  /** Everything that would be stored on extraction (persistable items only). */
  persistableItems(): ItemAmount[] {
    const out = new Map<ItemId, number>();
    const add = (itemId: ItemId, qty: number) => {
      const def = getItemDef(itemId);
      if (!def.persistable || def.metadata.starter) return;
      out.set(itemId, (out.get(itemId) ?? 0) + qty);
    };
    for (const s of this.slots) if (s) add(s.itemId, s.qty);
    if (this.secure) add(this.secure.itemId, this.secure.qty);
    for (const w of this.weapons) if (w) add(w.itemId, 1);
    return [...out.entries()].map(([itemId, qty]) => ({ itemId, qty }));
  }
}
