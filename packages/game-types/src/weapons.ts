import type { AmmoType, ItemId, Rarity } from './items';

/**
 * Weapon ids. The array order is the compact network index, so new weapons
 * are appended (never reordered).
 */
export const WEAPON_IDS = [
  'basic_pistol',
  'smg',
  'assault_rifle',
  'shotgun',
  'heavy_pistol',
  'suppressed_smg',
  'burst_rifle',
  'battle_rifle',
  'auto_shotgun',
  'marksman_rifle',
  'lmg',
  'void_rifle',
] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const WEAPON_CATEGORIES = ['PISTOL', 'SMG', 'RIFLE', 'SHOTGUN', 'MARKSMAN', 'LMG'] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

/**
 * How the trigger turns into shots. Pellet count (shotguns) is orthogonal:
 * a SEMI weapon with 8 pellets is a pump shotgun. CHARGE / BEAM / PROJECTILE
 * modes are future work and would slot in here.
 */
export type FireMode = 'SEMI' | 'AUTO' | 'BURST';

/** MAGAZINE: whole mag at once. SHELL: one round at a time, interruptible. */
export type ReloadStyle = 'MAGAZINE' | 'SHELL';

/** Weapon state machine as seen by HUD / animation (derived, never stored as booleans). */
export type WeaponPhase = 'READY' | 'FIRING' | 'COOLDOWN' | 'RELOADING' | 'EMPTY' | 'SWITCHING' | 'DEAD';

export type MuzzleFlashType = 'pistol' | 'magnum' | 'smg' | 'suppressed' | 'rifle' | 'battle' | 'shotgun' | 'sniper' | 'lmg' | 'void';
export type TracerType = 'light' | 'standard' | 'pellet' | 'heavy' | 'sniper' | 'void';
export type ImpactType = 'light' | 'standard' | 'pellet' | 'heavy' | 'void';
export type CasingType = 'pistol' | 'rifle' | 'heavy' | 'shell' | 'none';

export interface DamageFalloff {
  /** Full damage up to this distance. */
  startRange: number;
  /** Minimum multiplier reached at this distance. */
  endRange: number;
  minMultiplier: number;
}

/** Keys into the client's procedural sound library (one profile per key). */
export interface WeaponAudioKeys {
  fire: string;
  reload: string;
  empty: string;
  equip: string;
  pickup: string;
  impact: string;
}

/** Purely visual / feel parameters (the server ignores these). */
export interface WeaponVisualConfig {
  /** Muzzle distance from the character centre along the aim (world units). */
  muzzleDistance: number;
  /** Overall model length (grip to muzzle, model units). */
  length: number;
  /** Extra forward offset of the weapon pivot, per weapon type. */
  holdOffset: number;
  muzzleFlash: MuzzleFlashType;
  tracer: TracerType;
  /** Every Nth round draws a bright tracer; the others only a faint streak. */
  tracerEvery: number;
  tracerColor: number;
  impact: ImpactType;
  casing: CasingType;
  /** Weapon kickback per shot (model units) and its recovery speed (1/s). */
  kick: number;
  kickRecovery: number;
  /** Muzzle climb (radians) of the weapon model per shot. */
  kickTilt: number;
  /** Camera impulse against the shot direction (world units) and shake (0..1). */
  cameraKick: number;
  screenShake: number;
  /** Sustained-fire vibration (LMG), 0 = none. */
  vibration: number;
  /** Accent colour of the model (rarity-independent trim, e.g. the void rifle's glow). */
  accent: number | null;
}

/** Future attachment slots (data only; no attachment UI yet). */
export const ATTACHMENT_SLOTS = ['scope', 'magazine', 'barrel', 'grip', 'stock'] as const;
export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];

/**
 * Multiplicative / additive stat changes applied by attachments or rarity
 * variants. Variants should improve handling, never multiply damage.
 */
export interface WeaponStatModifiers {
  spreadMul?: number;
  bloomMul?: number;
  reloadMul?: number;
  equipMul?: number;
  magazineBonus?: number;
  moveSpeedMul?: number;
  rangeMul?: number;
  recoilMul?: number;
}

export interface WeaponDefinition {
  id: WeaponId;
  itemId: ItemId;
  /** Fictional model name, e.g. "Havoc AR". */
  name: string;
  /** Short generic label shown under the name, e.g. "Assault Rifle". */
  displayName: string;
  category: WeaponCategory;
  rarity: Rarity;
  description: string;

  /** Damage per bullet / pellet. */
  damage: number;
  /** Scales how much armor a hit strips (1 = normal, >1 armor-piercing). */
  armorDamageMultiplier: number;
  /** Reserved: the top-down game has no head hitbox yet. */
  headshotMultiplier?: number;

  fireMode: FireMode;
  /** Rounds per minute (cyclic rate; for BURST the rate between bursts). */
  fireRate: number;
  /** Derived: 60000 / fireRate. */
  fireIntervalMs: number;
  /** Rounds per burst (BURST) and the delay between them. */
  burstCount: number;
  burstDelayMs: number;

  magazineSize: number;
  ammoType: AmmoType;
  reloadStyle: ReloadStyle;
  /** Full reload from empty (MAGAZINE) or the reload start-up (SHELL). */
  reloadMs: number;
  /** Reload with rounds still chambered (MAGAZINE only). */
  tacticalReloadMs: number;
  /** Time per inserted round (SHELL only). */
  shellReloadMs: number;
  /** Raise time after switching to this weapon. */
  equipMs: number;

  projectileSpeed: number;
  /** Max travel distance; projectile lifetime = range / projectileSpeed. */
  range: number;
  falloff: DamageFalloff;
  /** Players a round can pass through (damage x0.6 each time). */
  pierce: number;

  /** Base spread (radians, half-angle) standing still / moving. */
  spreadStanding: number;
  spreadMoving: number;
  /** Bloom added per shot, its cap, recovery (rad/s) and the delay before it recovers. */
  spreadAfterShot: number;
  spreadMax: number;
  spreadRecovery: number;
  spreadRecoveryDelayMs: number;

  /** Pellets per shot and the half-angle of the pellet pattern. */
  pelletCount: number;
  pelletSpread: number;

  /** Movement speed while this weapon is equipped. */
  movementSpeedMultiplier: number;

  /** Visual recoil strength (0..1) and recovery (1/s) of the character's kick. */
  recoil: number;
  recoilRecovery: number;

  audio: WeaponAudioKeys;
  visual: WeaponVisualConfig;
  attachmentSlots: readonly AttachmentSlot[];
}

export interface WeaponInstance {
  uid: string;
  itemId: ItemId;
  weaponId: WeaponId;
  /** Rounds currently in the magazine. */
  mag: number;
}
