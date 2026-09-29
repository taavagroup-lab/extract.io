import type { AmmoReserves } from '@extract/game-types';

export const PLAYER_CONFIG = {
  radius: 22,
  maxHealth: 100,
  startHealth: 100,
  maxArmor: 100,
  startArmor: 0,
  /** Units per second. */
  movementSpeed: 255,
  dash: {
    speedMultiplier: 3.1,
    /** Seconds. */
    duration: 0.17,
    /** Seconds. */
    cooldown: 3,
  },
  /** Fraction of incoming damage absorbed by armor while armor lasts. */
  armorAbsorbRatio: 0.5,
  bagSlots: 20,
  weaponSlots: 3,
  interactRange: 95,
  /** Ammo items are picked up automatically within this range. */
  autoPickupRange: 40,
  startAmmo: { light: 48, rifle: 0, shell: 0, heavy: 0 } satisfies AmmoReserves,
  maxAmmo: { light: 240, rifle: 240, shell: 60, heavy: 60 } satisfies AmmoReserves,
  /** Visual label clearance for names, used by the client. */
  nameOffset: 38,
} as const;
