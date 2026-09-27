import { NETWORK_CONFIG, PLAYER_CONFIG, isItemId } from '@extract/game-config';
import type { ClientAction, ClientMessage, DevCommand, InputCmd, InventoryOp } from '@extract/game-types';

/**
 * Strict structural validation of untrusted client messages. Anything that
 * does not match exactly is rejected (returns null). Game-rule validation
 * (distances, cooldowns, ownership) happens later in the simulation.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isIntIn = (v: unknown, min: number, max: number): v is number => isInt(v) && (v as number) >= min && (v as number) <= max;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function validateInput(v: unknown): InputCmd | null {
  if (!isObj(v)) return null;
  const { s, mx, my, a, b } = v;
  if (!isIntIn(s, 0, 2 ** 31) || !isIntIn(mx, -1, 1) || !isIntIn(my, -1, 1) || !isFiniteNum(a) || !isIntIn(b, 0, 255)) {
    return null;
  }
  return { s, mx, my, a, b };
}

function validateAction(v: unknown): ClientAction | null {
  if (!isObj(v)) return null;
  switch (v.k) {
    case 'reload':
      return { k: 'reload' };
    case 'interact':
      return { k: 'interact' };
    case 'switch':
      return isIntIn(v.slot, 0, PLAYER_CONFIG.weaponSlots - 1) ? { k: 'switch', slot: v.slot } : null;
    case 'useItem':
      return isItemId(v.itemId) ? { k: 'useItem', itemId: v.itemId } : null;
    default:
      return null;
  }
}

function validateInventoryOp(v: unknown): InventoryOp | null {
  if (!isObj(v)) return null;
  const slotOk = isIntIn(v.slot, 0, PLAYER_CONFIG.bagSlots - 1);
  switch (v.op) {
    case 'drop':
      return slotOk ? { op: 'drop', slot: v.slot as number } : null;
    case 'secure':
      return slotOk ? { op: 'secure', slot: v.slot as number } : null;
    case 'use':
      return slotOk ? { op: 'use', slot: v.slot as number } : null;
    case 'unsecure':
      return { op: 'unsecure' };
    case 'dropWeapon':
      return isIntIn(v.slot, 0, PLAYER_CONFIG.weaponSlots - 1) ? { op: 'dropWeapon', slot: v.slot } : null;
    default:
      return null;
  }
}

function validateDev(v: unknown): DevCommand | null {
  if (!isObj(v)) return null;
  switch (v.cmd) {
    case 'spawnItem':
      return isItemId(v.itemId) && isIntIn(v.qty, 1, 999) ? { cmd: 'spawnItem', itemId: v.itemId, qty: v.qty } : null;
    case 'spawnBots':
      return isIntIn(v.count, 1, 100) ? { cmd: 'spawnBots', count: v.count } : null;
    case 'damage':
      return isIntIn(v.amount, 1, 1000) && (v.target === 'self' || v.target === 'nearest')
        ? { cmd: 'damage', amount: v.amount, target: v.target }
        : null;
    case 'teleport':
      return isFiniteNum(v.x) && isFiniteNum(v.y) ? { cmd: 'teleport', x: v.x, y: v.y } : null;
    case 'setMatchTime':
      return isIntIn(v.ms, 0, 60 * 60 * 1000) ? { cmd: 'setMatchTime', ms: v.ms } : null;
    case 'activateExtraction':
    case 'giveLegendary':
    case 'heal':
    case 'endMatch':
      return { cmd: v.cmd };
    default:
      return null;
  }
}

export function validateClientMessage(v: unknown): ClientMessage | null {
  if (!isObj(v)) return null;
  switch (v.t) {
    case 'join': {
      const token = v.token === null || v.token === undefined ? null : isStr(v.token, 2048) ? v.token : undefined;
      if (token === undefined) return null;
      const msg: ClientMessage = { t: 'join', token };
      if (v.name !== undefined) {
        if (!isStr(v.name, 32)) return null;
        msg.name = v.name;
      }
      if (v.reconnectKey !== undefined && v.reconnectKey !== null) {
        if (!isStr(v.reconnectKey, 128)) return null;
        msg.reconnectKey = v.reconnectKey;
      }
      return msg;
    }
    case 'input': {
      if (!Array.isArray(v.i) || v.i.length === 0 || v.i.length > NETWORK_CONFIG.input.maxBatch) return null;
      const inputs: InputCmd[] = [];
      for (const raw of v.i) {
        const cmd = validateInput(raw);
        if (!cmd) return null;
        inputs.push(cmd);
      }
      return { t: 'input', i: inputs };
    }
    case 'act': {
      const a = validateAction(v.a);
      return a ? { t: 'act', a } : null;
    }
    case 'inv': {
      const o = validateInventoryOp(v.o);
      return o ? { t: 'inv', o } : null;
    }
    case 'ping':
      return isFiniteNum(v.c) ? { t: 'ping', c: v.c } : null;
    case 'dev': {
      const d = validateDev(v.d);
      return d ? { t: 'dev', d } : null;
    }
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,16}$/;

export function isValidUsername(name: unknown): name is string {
  return typeof name === 'string' && USERNAME_RE.test(name);
}
