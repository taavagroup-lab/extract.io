import { WEAPON_IDS, type WeaponDefinition, type WeaponId } from '@extract/game-types';

export const WEAPONS: Readonly<Record<WeaponId, WeaponDefinition>> = {
  basic_pistol: {
    id: 'basic_pistol',
    itemId: 'basic_pistol',
    name: 'Basic Pistol',
    damage: 15,
    fireIntervalMs: 380,
    magazineSize: 12,
    reloadMs: 1300,
    bulletSpeed: 1500,
    range: 700,
    spread: 0.035,
    pellets: 1,
    ammoType: 'light',
    falloff: { startRange: 300, endRange: 700, minMultiplier: 0.7 },
    bulletColor: 0xfde68a,
    barrelLength: 30,
  },
  smg: {
    id: 'smg',
    itemId: 'smg',
    name: 'SMG',
    damage: 9,
    fireIntervalMs: 75,
    magazineSize: 30,
    reloadMs: 1800,
    bulletSpeed: 1650,
    range: 650,
    spread: 0.085,
    pellets: 1,
    ammoType: 'light',
    falloff: { startRange: 250, endRange: 650, minMultiplier: 0.6 },
    bulletColor: 0x93c5fd,
    barrelLength: 34,
  },
  assault_rifle: {
    id: 'assault_rifle',
    itemId: 'assault_rifle',
    name: 'Assault Rifle',
    damage: 20,
    fireIntervalMs: 140,
    magazineSize: 25,
    reloadMs: 2200,
    bulletSpeed: 2100,
    range: 1050,
    spread: 0.035,
    pellets: 1,
    ammoType: 'rifle',
    falloff: { startRange: 600, endRange: 1050, minMultiplier: 0.75 },
    bulletColor: 0xfca5a5,
    barrelLength: 42,
  },
  shotgun: {
    id: 'shotgun',
    itemId: 'shotgun',
    name: 'Shotgun',
    damage: 12,
    fireIntervalMs: 850,
    magazineSize: 6,
    reloadMs: 2400,
    bulletSpeed: 1400,
    range: 420,
    spread: 0.2,
    pellets: 8,
    ammoType: 'shell',
    falloff: { startRange: 140, endRange: 420, minMultiplier: 0.25 },
    bulletColor: 0xfdba74,
    barrelLength: 36,
  },
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
