import { Store } from './store';

/** DEV-only weapon debug overlays (toggled from the dev panel, never shown in production). */
export interface WeaponDebugFlags {
  hitboxes: boolean;
  paths: boolean;
  spread: boolean;
  muzzle: boolean;
  stats: boolean;
}

export const weaponDebugFlags = new Store<WeaponDebugFlags>({ hitboxes: false, paths: false, spread: false, muzzle: false, stats: false });
