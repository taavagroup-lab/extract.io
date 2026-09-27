/**
 * Character skins (visual only). Every player gets one deterministically from
 * their name so everybody sees the same outfit. Later: owned cosmetics.
 */
export interface CharacterSkin {
  id: string;
  name: string;
  vest: number;
  vestDark: number;
  helmet: number;
  visor: number;
  gloves: number;
  skinTone: number;
}

export const SKINS: readonly CharacterSkin[] = [
  { id: 'urban', name: 'Urban Ops', vest: 0x5b6472, vestDark: 0x2d333c, helmet: 0x232a33, visor: 0x22d3ee, gloves: 0x1a1d22, skinTone: 0xd9a47e },
  { id: 'desert', name: 'Dune Runner', vest: 0xb8925a, vestDark: 0x6e5431, helmet: 0x7c5f3a, visor: 0xf59e0b, gloves: 0x3b2d1c, skinTone: 0xc68b62 },
  { id: 'arctic', name: 'Whiteout', vest: 0xb9c4d0, vestDark: 0x6f7c8c, helmet: 0x8d99a8, visor: 0x38bdf8, gloves: 0x3b4452, skinTone: 0xf0c7a4 },
  { id: 'jungle', name: 'Viper Green', vest: 0x4a7a3f, vestDark: 0x25401f, helmet: 0x2c4a26, visor: 0xa3e635, gloves: 0x1c2a17, skinTone: 0xa9724c },
  { id: 'crimson', name: 'Crimson Unit', vest: 0xa8323a, vestDark: 0x541a1e, helmet: 0x3a1417, visor: 0xfb7185, gloves: 0x1f0d0f, skinTone: 0xe0b08a },
  { id: 'neon', name: 'Neon Night', vest: 0x3b2f8f, vestDark: 0x1e1850, helmet: 0x15123a, visor: 0xe879f9, gloves: 0x0f0c26, skinTone: 0x8d5a3b },
  { id: 'ghost', name: 'Ghost', vest: 0x2a3140, vestDark: 0x141820, helmet: 0x0d1016, visor: 0xb6f23d, gloves: 0x0a0c10, skinTone: 0xe6b894 },
  { id: 'gilded', name: 'Gilded', vest: 0x9a7a24, vestDark: 0x4a3a10, helmet: 0x2b2208, visor: 0xfacc15, gloves: 0x1c1606, skinTone: 0xb67c56 },
];

export function skinFor(name: string): CharacterSkin {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return SKINS[(h >>> 0) % SKINS.length]!;
}
