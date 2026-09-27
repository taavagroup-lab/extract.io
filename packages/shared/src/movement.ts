import { PLAYER_CONFIG } from '@extract/game-config';
import { INPUT_BUTTONS, type InputCmd } from '@extract/game-types';
import type { CollisionWorld } from './collision';

/** The subset of player state that movement prediction needs. */
export interface MoveState {
  x: number;
  y: number;
  /** Remaining dash time (s). */
  dashTime: number;
  /** Remaining dash cooldown (s). */
  dashCooldown: number;
  dashDirX: number;
  dashDirY: number;
}

export interface MoveParams {
  radius: number;
  speed: number;
  dashSpeedMultiplier: number;
  dashDuration: number;
  dashCooldown: number;
}

export const DEFAULT_MOVE_PARAMS: MoveParams = {
  radius: PLAYER_CONFIG.radius,
  speed: PLAYER_CONFIG.movementSpeed,
  dashSpeedMultiplier: PLAYER_CONFIG.dash.speedMultiplier,
  dashDuration: PLAYER_CONFIG.dash.duration,
  dashCooldown: PLAYER_CONFIG.dash.cooldown,
};

/** Clamps an axis value to -1, 0 or 1. Anything else is treated as 0. */
export function sanitizeAxis(v: number): -1 | 0 | 1 {
  return v > 0.5 ? 1 : v < -0.5 ? -1 : 0;
}

/**
 * Advances movement by one fixed step. Deterministic: the server and the
 * predicting client run exactly this code with the same inputs.
 */
export function stepMovement(
  s: MoveState,
  input: Pick<InputCmd, 'mx' | 'my' | 'b'>,
  dt: number,
  world: CollisionWorld,
  p: MoveParams = DEFAULT_MOVE_PARAMS,
): void {
  let dx: number = sanitizeAxis(input.mx);
  let dy: number = sanitizeAxis(input.my);
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
  }

  if (s.dashCooldown > 0) s.dashCooldown = Math.max(0, s.dashCooldown - dt);

  const wantsDash = (input.b & INPUT_BUTTONS.DASH) !== 0;
  if (wantsDash && s.dashCooldown <= 0 && s.dashTime <= 0 && len > 0) {
    s.dashTime = p.dashDuration;
    s.dashCooldown = p.dashCooldown;
    s.dashDirX = dx;
    s.dashDirY = dy;
  }

  let vx = dx * p.speed;
  let vy = dy * p.speed;
  if (s.dashTime > 0) {
    const dashSpeed = p.speed * p.dashSpeedMultiplier;
    vx = s.dashDirX * dashSpeed;
    vy = s.dashDirY * dashSpeed;
    s.dashTime = Math.max(0, s.dashTime - dt);
  }

  if (vx === 0 && vy === 0) return;

  // Sub-step so fast movement (dash) never tunnels through thin walls.
  const travel = Math.hypot(vx, vy) * dt;
  const steps = Math.max(1, Math.ceil(travel / (p.radius * 0.5)));
  const sx = (vx * dt) / steps;
  const sy = (vy * dt) / steps;
  for (let i = 0; i < steps; i++) {
    s.x += sx;
    s.y += sy;
    world.resolveCircle(s, p.radius);
  }
}

/** Upper bound of distance a player can legally travel in `dt` seconds. */
export function maxTravelDistance(dt: number, p: MoveParams = DEFAULT_MOVE_PARAMS): number {
  return p.speed * p.dashSpeedMultiplier * dt + 1;
}
