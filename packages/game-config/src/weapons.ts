import {
  WEAPON_IDS,
  type AttachmentSlot,
  type WeaponCategory,
  type WeaponDefinition,
  type WeaponId,
  type WeaponStatModifiers,
  type WeaponVisualConfig,
} from '@extract/game-types';

type Input = Omit<
  WeaponDefinition,
  | 'fireIntervalMs'
  | 'burstCount'
  | 'burstDelayMs'
  | 'tacticalReloadMs'
  | 'shellReloadMs'
  | 'reloadStyle'
  | 'armorDamageMultiplier'
  | 'pierce'
  | 'pelletCount'
  | 'pelletSpread'
  | 'spreadRecoveryDelayMs'
  | 'audio'
  | 'visual'
  | 'attachmentSlots'
  | 'itemId'
> &
  Partial<Pick<WeaponDefinition, 'burstCount' | 'burstDelayMs' | 'tacticalReloadMs' | 'shellReloadMs' | 'reloadStyle' | 'armorDamageMultiplier' | 'pierce' | 'pelletCount' | 'pelletSpread' | 'spreadRecoveryDelayMs'>> & {
    audio?: Partial<WeaponDefinition['audio']>;
    visual: Partial<WeaponVisualConfig> & Pick<WeaponVisualConfig, 'muzzleDistance' | 'length' | 'muzzleFlash' | 'tracer' | 'tracerColor'>;
  };

const SLOTS: Record<WeaponCategory, readonly AttachmentSlot[]> = {
  PISTOL: ['barrel', 'magazine'],
  SMG: ['scope', 'barrel', 'magazine', 'stock'],
  RIFLE: ['scope', 'barrel', 'magazine', 'grip', 'stock'],
  SHOTGUN: ['barrel', 'magazine', 'stock'],
  MARKSMAN: ['scope', 'barrel', 'magazine', 'stock'],
  LMG: ['scope', 'barrel', 'grip'],
};

/** Fills defaults and derived values so every definition is complete. */
function weapon(d: Input): WeaponDefinition {
  const v = d.visual;
  return {
    burstCount: 1,
    burstDelayMs: 0,
    reloadStyle: 'MAGAZINE',
    shellReloadMs: 0,
    armorDamageMultiplier: 1,
    pierce: 0,
    pelletCount: 1,
    pelletSpread: 0,
    spreadRecoveryDelayMs: 90,
    ...d,
    itemId: d.id,
    fireIntervalMs: 60_000 / d.fireRate,
    tacticalReloadMs: d.tacticalReloadMs ?? d.reloadMs,
    audio: {
      fire: d.id,
      reload: d.reloadStyle === 'SHELL' ? 'shell' : d.category === 'PISTOL' ? 'pistol' : d.category === 'LMG' ? 'belt' : 'rifle',
      empty: 'click',
      equip: d.category === 'PISTOL' ? 'holster' : 'sling',
      pickup: 'weapon',
      impact: v.tracer === 'pellet' ? 'pellet' : 'bullet',
      ...d.audio,
    },
    visual: {
      holdOffset: 0,
      tracerEvery: 1,
      impact: 'standard',
      casing: 'rifle',
      kick: 3,
      kickRecovery: 14,
      kickTilt: 0.04,
      cameraKick: 2,
      screenShake: 0.05,
      vibration: 0,
      accent: null,
      ...v,
    },
    attachmentSlots: SLOTS[d.category],
  };
}

/**
 * Weapon balance (single source of truth, shared by server and client).
 *
 * Roles: pistol = backup, heavy pistol = precise hand cannon, SMGs = close
 * range tracking, AR = all-rounder, burst = skill mid range, battle rifle =
 * precision damage, shotguns = extreme close range, marksman = long range,
 * LMG = sustained suppression, void rifle = rare legendary handling upgrade.
 *
 * Time-to-kill without armour (100 HP, every round hitting at close range):
 *   Scout-9 8 hits / 1.27 s · Hammer .50 3 / 1.04 s · Viper-9 8 / 0.47 s
 *   Wisp SD 10 / 0.69 s · Havoc AR 6 / 0.50 s · Raven MK2 5 / 0.60 s
 *   Warden BR 3 / 0.60 s · Breaker-12 1 pump (all 8 pellets, point blank)
 *   Hailstorm 3 / 0.55 s · Longshot 2 / 1.25 s · Atlas LMG 8 / 0.58 s
 *   Void Rifle 6 / 0.50 s (pierces one target)
 * Falloff and spread stretch all of these outside each weapon's range.
 */
export const WEAPONS: Readonly<Record<WeaponId, WeaponDefinition>> = {
  basic_pistol: weapon({
    id: 'basic_pistol',
    name: 'Scout-9',
    displayName: 'Pistol',
    category: 'PISTOL',
    rarity: 'COMMON',
    description: 'Reliable starter sidearm. Accurate, quick to handle, weak.',
    damage: 14,
    fireMode: 'SEMI',
    fireRate: 330,
    magazineSize: 12,
    ammoType: 'light',
    reloadMs: 1250,
    tacticalReloadMs: 1050,
    equipMs: 200,
    projectileSpeed: 1700,
    range: 760,
    falloff: { startRange: 300, endRange: 760, minMultiplier: 0.65 },
    spreadStanding: 0.016,
    spreadMoving: 0.045,
    spreadAfterShot: 0.022,
    spreadMax: 0.06,
    spreadRecovery: 0.35,
    movementSpeedMultiplier: 1,
    recoil: 0.25,
    recoilRecovery: 16,
    visual: { muzzleDistance: 44, length: 19, muzzleFlash: 'pistol', tracer: 'light', tracerEvery: 1, tracerColor: 0xffe7a8, impact: 'light', casing: 'pistol', kick: 2.4, kickTilt: 0.05, cameraKick: 1.5, screenShake: 0.04 },
  }),
  heavy_pistol: weapon({
    id: 'heavy_pistol',
    name: 'Hammer .50',
    displayName: 'Heavy Pistol',
    category: 'PISTOL',
    rarity: 'RARE',
    description: 'Hand cannon. Three clean hits drop a target; the kick punishes spam.',
    damage: 38,
    armorDamageMultiplier: 1.2,
    fireMode: 'SEMI',
    fireRate: 115,
    magazineSize: 6,
    ammoType: 'heavy',
    reloadMs: 1750,
    tacticalReloadMs: 1500,
    equipMs: 300,
    projectileSpeed: 2100,
    range: 860,
    falloff: { startRange: 360, endRange: 860, minMultiplier: 0.7 },
    spreadStanding: 0.012,
    spreadMoving: 0.06,
    spreadAfterShot: 0.07,
    spreadMax: 0.12,
    spreadRecovery: 0.3,
    spreadRecoveryDelayMs: 160,
    movementSpeedMultiplier: 1,
    recoil: 0.85,
    recoilRecovery: 9,
    visual: { muzzleDistance: 50, length: 24, muzzleFlash: 'magnum', tracer: 'heavy', tracerColor: 0xffc27a, impact: 'heavy', casing: 'heavy', kick: 6, kickTilt: 0.22, kickRecovery: 9, cameraKick: 6, screenShake: 0.16 },
  }),
  smg: weapon({
    id: 'smg',
    name: 'Viper-9',
    displayName: 'SMG',
    category: 'SMG',
    rarity: 'RARE',
    description: 'Blistering fire rate. Wins close fights, sprays at range.',
    damage: 13,
    fireMode: 'AUTO',
    fireRate: 900,
    magazineSize: 32,
    ammoType: 'light',
    reloadMs: 1900,
    tacticalReloadMs: 1600,
    equipMs: 260,
    projectileSpeed: 1700,
    range: 660,
    falloff: { startRange: 220, endRange: 620, minMultiplier: 0.55 },
    spreadStanding: 0.034,
    spreadMoving: 0.058,
    spreadAfterShot: 0.011,
    spreadMax: 0.1,
    spreadRecovery: 0.32,
    movementSpeedMultiplier: 1.05,
    recoil: 0.3,
    recoilRecovery: 20,
    visual: { muzzleDistance: 47, length: 30, muzzleFlash: 'smg', tracer: 'standard', tracerEvery: 3, tracerColor: 0xffd27a, impact: 'light', casing: 'pistol', kick: 1.8, kickTilt: 0.03, kickRecovery: 22, cameraKick: 0.8, screenShake: 0.025 },
  }),
  suppressed_smg: weapon({
    id: 'suppressed_smg',
    name: 'Wisp SD',
    displayName: 'Suppressed SMG',
    category: 'SMG',
    rarity: 'RARE',
    description: 'Integrally suppressed. Tighter grouping, quieter report, dimmer flash.',
    damage: 11,
    fireMode: 'AUTO',
    fireRate: 800,
    magazineSize: 30,
    ammoType: 'light',
    reloadMs: 2000,
    tacticalReloadMs: 1700,
    equipMs: 280,
    projectileSpeed: 1800,
    range: 720,
    falloff: { startRange: 280, endRange: 700, minMultiplier: 0.6 },
    spreadStanding: 0.022,
    spreadMoving: 0.04,
    spreadAfterShot: 0.008,
    spreadMax: 0.066,
    spreadRecovery: 0.36,
    movementSpeedMultiplier: 1.05,
    recoil: 0.22,
    recoilRecovery: 22,
    visual: { muzzleDistance: 56, length: 38, muzzleFlash: 'suppressed', tracer: 'light', tracerEvery: 4, tracerColor: 0xc9d8ff, impact: 'light', casing: 'pistol', kick: 1.4, kickTilt: 0.02, kickRecovery: 24, cameraKick: 0.6, screenShake: 0.015 },
  }),
  assault_rifle: weapon({
    id: 'assault_rifle',
    name: 'Havoc AR',
    displayName: 'Assault Rifle',
    category: 'RIFLE',
    rarity: 'EPIC',
    description: 'Controllable all-rounder with real range.',
    damage: 17,
    fireMode: 'AUTO',
    fireRate: 600,
    magazineSize: 30,
    ammoType: 'rifle',
    reloadMs: 2300,
    tacticalReloadMs: 1900,
    equipMs: 380,
    projectileSpeed: 2300,
    range: 1080,
    falloff: { startRange: 560, endRange: 1080, minMultiplier: 0.75 },
    spreadStanding: 0.013,
    spreadMoving: 0.042,
    spreadAfterShot: 0.0075,
    spreadMax: 0.055,
    spreadRecovery: 0.22,
    spreadRecoveryDelayMs: 110,
    movementSpeedMultiplier: 0.96,
    recoil: 0.4,
    recoilRecovery: 16,
    visual: { muzzleDistance: 65, length: 46, muzzleFlash: 'rifle', tracer: 'standard', tracerEvery: 2, tracerColor: 0xffc080, kick: 2.6, kickTilt: 0.035, cameraKick: 1.6, screenShake: 0.04 },
  }),
  burst_rifle: weapon({
    id: 'burst_rifle',
    name: 'Raven MK2',
    displayName: 'Burst Rifle',
    category: 'RIFLE',
    rarity: 'EPIC',
    description: 'Three-round burst with a laser-tight grouping. Rewards aim.',
    damage: 21,
    fireMode: 'BURST',
    burstCount: 3,
    burstDelayMs: 66,
    fireRate: 150,
    magazineSize: 24,
    ammoType: 'rifle',
    reloadMs: 2200,
    tacticalReloadMs: 1850,
    equipMs: 360,
    projectileSpeed: 2700,
    range: 1150,
    falloff: { startRange: 650, endRange: 1150, minMultiplier: 0.8 },
    spreadStanding: 0.007,
    spreadMoving: 0.034,
    spreadAfterShot: 0.004,
    spreadMax: 0.03,
    spreadRecovery: 0.25,
    movementSpeedMultiplier: 0.97,
    recoil: 0.45,
    recoilRecovery: 14,
    visual: { muzzleDistance: 58, length: 44, muzzleFlash: 'rifle', tracer: 'standard', tracerEvery: 1, tracerColor: 0x9fe6ff, kick: 2.8, kickTilt: 0.04, cameraKick: 1.8, screenShake: 0.05 },
  }),
  battle_rifle: weapon({
    id: 'battle_rifle',
    name: 'Warden BR',
    displayName: 'Battle Rifle',
    category: 'RIFLE',
    rarity: 'EPIC',
    description: 'Full-power semi-auto. Heavy hits, heavy kick, strips armour.',
    damage: 34,
    armorDamageMultiplier: 1.25,
    fireMode: 'SEMI',
    fireRate: 200,
    magazineSize: 15,
    ammoType: 'heavy',
    reloadMs: 2600,
    tacticalReloadMs: 2200,
    equipMs: 450,
    projectileSpeed: 2900,
    range: 1260,
    falloff: { startRange: 700, endRange: 1260, minMultiplier: 0.8 },
    spreadStanding: 0.009,
    spreadMoving: 0.06,
    spreadAfterShot: 0.05,
    spreadMax: 0.1,
    spreadRecovery: 0.36,
    spreadRecoveryDelayMs: 140,
    movementSpeedMultiplier: 0.92,
    recoil: 0.8,
    recoilRecovery: 10,
    visual: { muzzleDistance: 73, length: 52, muzzleFlash: 'battle', tracer: 'heavy', tracerEvery: 1, tracerColor: 0xffb060, impact: 'heavy', casing: 'heavy', kick: 5, kickTilt: 0.12, kickRecovery: 10, cameraKick: 5, screenShake: 0.13 },
  }),
  shotgun: weapon({
    id: 'shotgun',
    name: 'Breaker-12',
    displayName: 'Shotgun',
    category: 'SHOTGUN',
    rarity: 'RARE',
    description: 'Pump action. Eight pellets that end fights at arm’s length.',
    damage: 13,
    armorDamageMultiplier: 0.85,
    fireMode: 'SEMI',
    fireRate: 68,
    pelletCount: 8,
    pelletSpread: 0.15,
    magazineSize: 6,
    ammoType: 'shell',
    reloadStyle: 'SHELL',
    reloadMs: 380,
    shellReloadMs: 470,
    equipMs: 420,
    projectileSpeed: 1550,
    range: 440,
    falloff: { startRange: 110, endRange: 400, minMultiplier: 0.18 },
    spreadStanding: 0.008,
    spreadMoving: 0.03,
    spreadAfterShot: 0,
    spreadMax: 0,
    spreadRecovery: 1,
    movementSpeedMultiplier: 0.95,
    recoil: 1,
    recoilRecovery: 7,
    visual: { muzzleDistance: 64, length: 46, muzzleFlash: 'shotgun', tracer: 'pellet', tracerEvery: 1, tracerColor: 0xffb15e, impact: 'pellet', casing: 'shell', kick: 7, kickTilt: 0.2, kickRecovery: 7, cameraKick: 9, screenShake: 0.3 },
  }),
  auto_shotgun: weapon({
    id: 'auto_shotgun',
    name: 'Hailstorm',
    displayName: 'Auto Shotgun',
    category: 'SHOTGUN',
    rarity: 'EPIC',
    description: 'Drum-fed automatic shotgun. Less per shot, relentless up close.',
    damage: 7,
    armorDamageMultiplier: 0.8,
    fireMode: 'AUTO',
    fireRate: 220,
    pelletCount: 6,
    pelletSpread: 0.21,
    magazineSize: 10,
    ammoType: 'shell',
    reloadMs: 2700,
    tacticalReloadMs: 2300,
    equipMs: 480,
    projectileSpeed: 1450,
    range: 390,
    falloff: { startRange: 90, endRange: 340, minMultiplier: 0.15 },
    spreadStanding: 0.02,
    spreadMoving: 0.05,
    spreadAfterShot: 0.03,
    spreadMax: 0.08,
    spreadRecovery: 0.3,
    movementSpeedMultiplier: 0.93,
    recoil: 0.7,
    recoilRecovery: 11,
    visual: { muzzleDistance: 58, length: 44, muzzleFlash: 'shotgun', tracer: 'pellet', tracerColor: 0xffc070, impact: 'pellet', casing: 'shell', kick: 4.5, kickTilt: 0.1, kickRecovery: 11, cameraKick: 4.5, screenShake: 0.16 },
  }),
  marksman_rifle: weapon({
    id: 'marksman_rifle',
    name: 'Longshot',
    displayName: 'Sniper Rifle',
    category: 'MARKSMAN',
    rarity: 'EPIC',
    description: 'Bolt-action precision. Near-instant rounds; plant your feet to use it.',
    damage: 70,
    armorDamageMultiplier: 1.5,
    fireMode: 'SEMI',
    fireRate: 48,
    magazineSize: 5,
    ammoType: 'heavy',
    reloadMs: 2900,
    tacticalReloadMs: 2500,
    equipMs: 600,
    projectileSpeed: 4400,
    range: 1650,
    falloff: { startRange: 1300, endRange: 1650, minMultiplier: 0.9 },
    spreadStanding: 0.0018,
    spreadMoving: 0.085,
    spreadAfterShot: 0.09,
    spreadMax: 0.12,
    spreadRecovery: 0.45,
    spreadRecoveryDelayMs: 300,
    movementSpeedMultiplier: 0.88,
    recoil: 1,
    recoilRecovery: 6,
    visual: { muzzleDistance: 86, length: 62, holdOffset: 2, muzzleFlash: 'sniper', tracer: 'sniper', tracerColor: 0xe8f4ff, impact: 'heavy', casing: 'heavy', kick: 8, kickTilt: 0.16, kickRecovery: 6, cameraKick: 11, screenShake: 0.26 },
  }),
  lmg: weapon({
    id: 'lmg',
    name: 'Atlas LMG',
    displayName: 'LMG',
    category: 'LMG',
    rarity: 'EPIC',
    description: 'Belt-fed suppression. Accurate first rounds, blooms under sustained fire.',
    damage: 14,
    fireMode: 'AUTO',
    fireRate: 720,
    magazineSize: 80,
    ammoType: 'rifle',
    reloadMs: 4300,
    tacticalReloadMs: 3700,
    equipMs: 700,
    projectileSpeed: 2200,
    range: 1020,
    falloff: { startRange: 500, endRange: 1020, minMultiplier: 0.7 },
    spreadStanding: 0.018,
    spreadMoving: 0.07,
    spreadAfterShot: 0.0042,
    spreadMax: 0.11,
    spreadRecovery: 0.09,
    spreadRecoveryDelayMs: 160,
    movementSpeedMultiplier: 0.84,
    recoil: 0.3,
    recoilRecovery: 18,
    visual: { muzzleDistance: 70, length: 50, muzzleFlash: 'lmg', tracer: 'standard', tracerEvery: 3, tracerColor: 0xff9a5c, kick: 1.6, kickTilt: 0.02, kickRecovery: 20, cameraKick: 1.1, screenShake: 0.035, vibration: 1 },
  }),
  void_rifle: weapon({
    id: 'void_rifle',
    name: 'Void Rifle',
    displayName: 'Prototype Rifle',
    category: 'RIFLE',
    rarity: 'LEGENDARY',
    description: 'Experimental coil rifle. Near-hitscan rounds that pierce one target. No extra damage, just perfect handling.',
    damage: 17,
    armorDamageMultiplier: 1.1,
    fireMode: 'AUTO',
    fireRate: 600,
    magazineSize: 36,
    ammoType: 'rifle',
    reloadMs: 2000,
    tacticalReloadMs: 1700,
    equipMs: 320,
    projectileSpeed: 4000,
    range: 1200,
    falloff: { startRange: 700, endRange: 1200, minMultiplier: 0.8 },
    pierce: 1,
    spreadStanding: 0.009,
    spreadMoving: 0.02,
    spreadAfterShot: 0.004,
    spreadMax: 0.028,
    spreadRecovery: 0.3,
    movementSpeedMultiplier: 1,
    recoil: 0.3,
    recoilRecovery: 18,
    audio: { reload: 'energy', equip: 'energy' },
    visual: { muzzleDistance: 65, length: 46, muzzleFlash: 'void', tracer: 'void', tracerColor: 0xb57bff, impact: 'void', casing: 'none', kick: 2, kickTilt: 0.03, cameraKick: 1.4, screenShake: 0.04, accent: 0xa35cff },
  }),
};

/** Compact network index for weapons (-1 = none). */
export function weaponIndex(id: WeaponId | null | undefined): number {
  return id ? WEAPON_IDS.indexOf(id) : -1;
}

export function weaponFromIndex(index: number): WeaponDefinition | null {
  const id = WEAPON_IDS[index];
  return id ? WEAPONS[id] : null;
}

export function isWeaponId(id: unknown): id is WeaponId {
  return typeof id === 'string' && (WEAPON_IDS as readonly string[]).includes(id);
}

/** Full reload time of a weapon given its current magazine (SHELL: per missing round). */
export function reloadDuration(def: WeaponDefinition, mag: number, reserve: number): number {
  const missing = Math.min(def.magazineSize - mag, reserve);
  if (missing <= 0) return 0;
  if (def.reloadStyle === 'SHELL') return def.reloadMs + missing * def.shellReloadMs;
  return mag > 0 ? def.tacticalReloadMs : def.reloadMs;
}

/**
 * Applies attachment / variant modifiers. Prepared for future variants
 * ("Havoc AR · Legendary"): they tune handling, never raw damage.
 */
export function applyWeaponModifiers(def: WeaponDefinition, mods: readonly WeaponStatModifiers[]): WeaponDefinition {
  if (mods.length === 0) return def;
  const m = (k: keyof WeaponStatModifiers, base = 1) => mods.reduce((acc, x) => acc * (x[k] ?? base), base);
  const spread = m('spreadMul');
  const reload = m('reloadMul');
  return {
    ...def,
    spreadStanding: def.spreadStanding * spread,
    spreadMoving: def.spreadMoving * spread,
    spreadAfterShot: def.spreadAfterShot * m('bloomMul'),
    reloadMs: Math.round(def.reloadMs * reload),
    tacticalReloadMs: Math.round(def.tacticalReloadMs * reload),
    shellReloadMs: Math.round(def.shellReloadMs * reload),
    equipMs: Math.round(def.equipMs * m('equipMul')),
    magazineSize: def.magazineSize + mods.reduce((acc, x) => acc + (x.magazineBonus ?? 0), 0),
    movementSpeedMultiplier: def.movementSpeedMultiplier * m('moveSpeedMul'),
    range: def.range * m('rangeMul'),
    recoil: def.recoil * m('recoilMul'),
  };
}
