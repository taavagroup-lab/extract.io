export const BOT_CONFIG = {
  names: [
    'Viper', 'Rook', 'Ghost', 'Nova', 'Kestrel', 'Onyx', 'Havoc', 'Wraith', 'Talon', 'Echo',
    'Rogue', 'Cinder', 'Blitz', 'Maverick', 'Specter', 'Jolt', 'Raven', 'Saber', 'Frost', 'Dune',
    'Vandal', 'Nomad', 'Pulse', 'Quartz', 'Rift', 'Shade', 'Torque', 'Vex', 'Zenith', 'Hex',
  ],
  /** Delay between spotting an enemy and opening fire. */
  reactionMs: [450, 950] as const,
  /** Random aim error (radians, each side). */
  aimError: 0.2,
  visionRange: 650,
  engageRange: 520,
  lootSearchRange: 1100,
  healBelowHp: 45,
  armorBelow: 50,
  repathIntervalMs: 1400,
  /** Small enough that every 70-unit door gap contains a walkable cell center. */
  navCellSize: 25,
  /** Bots start heading to extraction this long after EXTRACTION_PHASE begins (random in range). */
  extractDelayMs: [0, 60_000] as const,
  /** Probability per decision to ignore loot and wander instead. */
  wanderChance: 0.15,
  thinkIntervalMs: 250,
} as const;
