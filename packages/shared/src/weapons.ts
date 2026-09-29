import { PLAYER_CONFIG } from '@extract/game-config';
import type { WeaponDefinition, WeaponPhase } from '@extract/game-types';
import { DEFAULT_MOVE_PARAMS, type MoveParams } from './movement';

/**
 * Weapon controller shared by the server (authoritative) and the predicting
 * client (instant feedback). It is advanced once per fixed input step with
 * the same inputs on both sides, so fire cadence, bursts, bloom and the
 * resulting spread cone match exactly. Only the random offset inside the
 * cone stays server-side (a client-known seed would enable "no-spread"
 * cheats).
 *
 * State machine (see `weaponPhase`): READY -> FIRING -> COOLDOWN -> READY,
 * with EMPTY / RELOADING / SWITCHING / DEAD derived from the character.
 */
export interface WeaponRuntime {
  /** Weapon instance uid the state belongs to; a different uid means "just equipped". */
  key: string | null;
  /** ms until the next round may fire. Never below -dt (keeps the average rate exact without banking). */
  cooldownMs: number;
  /** Raise time left after equipping (ms). */
  equipLeftMs: number;
  /** Rounds still to come in the current burst. */
  burstLeft: number;
  /** A semi / burst trigger pull waiting for the cooldown (ms left). */
  bufferMs: number;
  triggerHeld: boolean;
  /** Extra spread from recent shots (radians). */
  bloom: number;
  /** ms since the last round. */
  sinceShotMs: number;
  /** Smoothed movement factor: 0 standing, 1 moving, 1.5 dashing. */
  motion: number;
  /** Rounds in the current trigger string. */
  streak: number;
  /** A trigger pull hit an empty magazine this step. */
  dry: boolean;
}

/** A trigger pull this early before the weapon is ready still fires (feels responsive). */
export const TRIGGER_BUFFER_MS = 140;
/** How quickly accuracy follows movement changes (1/s). */
const MOTION_RATE = 9;
/** Spread multiplier of the moving penalty while dashing (beyond 1). */
const DASH_SPREAD = 0.6;
/** Safety cap on rounds per step. */
const MAX_ROUNDS_PER_STEP = 4;

export function createWeaponRuntime(): WeaponRuntime {
  return { key: null, cooldownMs: 0, equipLeftMs: 0, burstLeft: 0, bufferMs: 0, triggerHeld: false, bloom: 0, sinceShotMs: 1e6, motion: 0, streak: 0, dry: false };
}

/**
 * Equip (switch / pickup): accuracy resets and the weapon cannot fire until
 * raised. The very first weapon of a life is already in hand (no raise).
 */
export function equipWeaponRuntime(rt: WeaponRuntime, key: string | null, def: WeaponDefinition | null): void {
  const first = rt.key === null;
  rt.key = key;
  rt.equipLeftMs = first ? 0 : (def?.equipMs ?? 0);
  rt.cooldownMs = Math.max(0, rt.equipLeftMs);
  rt.burstLeft = 0;
  rt.bufferMs = 0;
  rt.bloom = 0;
  rt.streak = 0;
  rt.sinceShotMs = 1e6;
  // triggerHeld is kept: holding fire through a swap never auto-fires a semi weapon.
}

export interface FireInput {
  trigger: boolean;
  moving: boolean;
  dashing: boolean;
  /** Rounds in the magazine. */
  ammo: number;
  /** False while reloading, using an item, dead... (the trigger is still tracked). */
  canFire: boolean;
}

/** Current spread half-angle (radians) of the cone the next round flies in. */
export function weaponSpread(rt: WeaponRuntime, def: WeaponDefinition): number {
  const m = Math.min(1, rt.motion);
  const dash = Math.max(0, rt.motion - 1) * 2;
  return def.spreadStanding + (def.spreadMoving - def.spreadStanding) * m + def.spreadMoving * DASH_SPREAD * dash + rt.bloom;
}

/**
 * Advances one fixed step. Writes the spread of every round fired this step
 * into `out` and returns how many rounds fired.
 */
export function stepWeapon(rt: WeaponRuntime, def: WeaponDefinition, input: FireInput, dtMs: number, out: number[]): number {
  out.length = 0;
  rt.dry = false;
  const target = input.dashing ? 1.5 : input.moving ? 1 : 0;
  rt.motion += (target - rt.motion) * Math.min(1, (dtMs / 1000) * MOTION_RATE);

  rt.sinceShotMs += dtMs;
  if (rt.sinceShotMs > def.spreadRecoveryDelayMs) rt.bloom = Math.max(0, rt.bloom - (def.spreadRecovery * dtMs) / 1000);
  if (rt.equipLeftMs > 0) rt.equipLeftMs = Math.max(0, rt.equipLeftMs - dtMs);

  const pressed = input.trigger && !rt.triggerHeld;
  rt.triggerHeld = input.trigger;
  if (pressed && def.fireMode !== 'AUTO') rt.bufferMs = TRIGGER_BUFFER_MS;
  if (rt.cooldownMs > 0) rt.cooldownMs -= dtMs;

  let ammo = input.ammo;
  let fired = 0;
  while (fired < MAX_ROUNDS_PER_STEP && rt.cooldownMs <= 0) {
    const wants = rt.burstLeft > 0 || (def.fireMode === 'AUTO' ? input.trigger : rt.bufferMs > 0);
    if (!wants) break;
    if (!input.canFire) {
      rt.burstLeft = 0;
      break;
    }
    if (ammo <= 0) {
      if (pressed) rt.dry = true;
      rt.burstLeft = 0;
      rt.bufferMs = 0;
      break;
    }
    if (rt.burstLeft === 0) {
      // A new trigger action: consume the buffered pull, start a burst.
      if (def.fireMode !== 'AUTO') rt.bufferMs = 0;
      if (def.fireMode === 'BURST') rt.burstLeft = def.burstCount;
    }

    out.push(weaponSpread(rt, def));
    ammo--;
    fired++;
    rt.bloom = Math.min(def.spreadMax, rt.bloom + def.spreadAfterShot);
    rt.sinceShotMs = 0;
    rt.streak++;
    if (rt.burstLeft > 0) rt.burstLeft--;
    rt.cooldownMs += rt.burstLeft > 0 ? def.burstDelayMs : def.fireIntervalMs;
  }
  if (fired === 0 && rt.cooldownMs < 0) rt.cooldownMs = 0;
  if (rt.bufferMs > 0) rt.bufferMs = Math.max(0, rt.bufferMs - dtMs);
  if (!input.trigger && rt.burstLeft === 0 && rt.sinceShotMs > def.fireIntervalMs) rt.streak = 0;
  return fired;
}

/**
 * Directions of one shot: the whole pattern is offset inside the spread
 * cone (triangular distribution: most rounds near the centre), pellets fan
 * out evenly with a little jitter so the pattern reads consistently.
 */
export function shotAngles(def: WeaponDefinition, aim: number, spread: number, rand: () => number, out: number[]): number[] {
  out.length = 0;
  const center = aim + (rand() + rand() - 1) * spread;
  const n = def.pelletCount;
  if (n <= 1) {
    out.push(center);
    return out;
  }
  const ps = def.pelletSpread;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * 2 - 1;
    out.push(center + t * ps + (rand() * 2 - 1) * (ps / n));
  }
  return out;
}

export interface WeaponPhaseContext {
  dead: boolean;
  reloading: boolean;
  mag: number;
}

/** HUD / animation state derived from the runtime + character (no stored booleans). */
export function weaponPhase(rt: WeaponRuntime, def: WeaponDefinition | null, ctx: WeaponPhaseContext): WeaponPhase {
  if (ctx.dead) return 'DEAD';
  if (!def) return 'READY';
  if (rt.equipLeftMs > 0) return 'SWITCHING';
  if (ctx.reloading) return 'RELOADING';
  if (ctx.mag <= 0) return 'EMPTY';
  if (rt.sinceShotMs < Math.min(120, def.fireIntervalMs)) return 'FIRING';
  if (rt.cooldownMs > 0) return 'COOLDOWN';
  return 'READY';
}

const moveParamCache = new Map<number, MoveParams>();

/** Movement parameters with the equipped weapon's speed multiplier (cached per multiplier). */
export function moveParamsFor(def: WeaponDefinition | null | undefined): MoveParams {
  const mul = def?.movementSpeedMultiplier ?? 1;
  let p = moveParamCache.get(mul);
  if (!p) {
    p = { ...DEFAULT_MOVE_PARAMS, speed: PLAYER_CONFIG.movementSpeed * mul };
    moveParamCache.set(mul, p);
  }
  return p;
}
