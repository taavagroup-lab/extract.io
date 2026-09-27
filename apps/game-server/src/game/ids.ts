import { randomBytes } from 'node:crypto';

let counter = 0;

/** Short unique id for item stacks / weapon instances inside a raid. */
export function uid(): string {
  counter = (counter + 1) % 0xffffff;
  return `${Date.now().toString(36)}${counter.toString(36)}${randomBytes(3).toString('hex')}`;
}

export function secretKey(): string {
  return randomBytes(24).toString('base64url');
}

export function matchId(): string {
  return `m_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}
