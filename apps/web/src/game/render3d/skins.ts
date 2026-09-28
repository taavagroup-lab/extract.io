/**
 * Operator outfits (visual only). Every player gets one deterministically from
 * their name so everybody sees the same kit. Muted tactical colourways; the
 * visor/goggle accent is the only saturated colour. Later: owned cosmetics.
 */
export interface CharacterSkin {
  id: string;
  name: string;
  /** Plate carrier. */
  vest: number;
  /** Pouches, straps, backpack. */
  vestDark: number;
  /** Combat shirt / sleeves. */
  shirt: number;
  pants: number;
  helmet: number;
  visor: number;
  gloves: number;
  boots: number;
  skinTone: number;
}

export const SKINS: readonly CharacterSkin[] = [
  { id: 'ranger', name: 'Ranger', vest: 0x4d5538, vestDark: 0x2f3524, shirt: 0x5a6246, pants: 0x3f4433, helmet: 0x3b4230, visor: 0x9ad14b, gloves: 0x23261c, boots: 0x2a2620, skinTone: 0xc68b62 },
  { id: 'multicam', name: 'Scorched Earth', vest: 0x9a8762, vestDark: 0x5c4d35, shirt: 0x8a7a5a, pants: 0x6f624a, helmet: 0x857657, visor: 0xf5a524, gloves: 0x3b3124, boots: 0x3a2e22, skinTone: 0xd9a47e },
  { id: 'urban', name: 'Urban Ops', vest: 0x30343a, vestDark: 0x1a1d21, shirt: 0x464b52, pants: 0x383c42, helmet: 0x1f2226, visor: 0x38d6e8, gloves: 0x141619, boots: 0x16181b, skinTone: 0xe0b08a },
  { id: 'arctic', name: 'Whiteout', vest: 0xb9c0c7, vestDark: 0x6b7481, shirt: 0xa3abb5, pants: 0x7f8894, helmet: 0x959fab, visor: 0x7dd3fc, gloves: 0x3b4452, boots: 0x2e343d, skinTone: 0xf0c7a4 },
  { id: 'navy', name: 'Riverine', vest: 0x2f3d52, vestDark: 0x1c2533, shirt: 0x3b4a60, pants: 0x2a3444, helmet: 0x1f2a38, visor: 0x60a5fa, gloves: 0x151b24, boots: 0x14181f, skinTone: 0x8d5a3b },
  { id: 'crimson', name: 'Crimson Unit', vest: 0x5a2b2b, vestDark: 0x2e1717, shirt: 0x3d3f45, pants: 0x2c2d31, helmet: 0x2a1d1d, visor: 0xff5a5a, gloves: 0x1a1414, boots: 0x181515, skinTone: 0xe6b894 },
  { id: 'ghost', name: 'Ghost', vest: 0x3a3f46, vestDark: 0x1e2126, shirt: 0x2d3137, pants: 0x25282d, helmet: 0x15171a, visor: 0xb6f23d, gloves: 0x0e1012, boots: 0x101113, skinTone: 0xb67c56 },
  { id: 'coyote', name: 'Coyote', vest: 0x8b6b43, vestDark: 0x4f3d26, shirt: 0x6e5a3e, pants: 0x5a4a34, helmet: 0x6b5534, visor: 0xfacc15, gloves: 0x2a2217, boots: 0x2b2118, skinTone: 0xa9724c },
];

export function skinFor(name: string): CharacterSkin {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return SKINS[(h >>> 0) % SKINS.length]!;
}
