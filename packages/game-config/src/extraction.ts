export const EXTRACTION_CONFIG = {
  /** Time a player must remain inside an active zone. */
  durationMs: 10_000,
  radius: 130,
  /** How many of the candidate points activate in EXTRACTION_PHASE. */
  activeCount: 3,
  /** Players within this distance are alerted when someone starts extracting. */
  alertRadius: 1500,
  cancelOnDamage: true,
  /** 0 = unlimited simultaneous extractions per zone. */
  maxSimultaneousPerZone: 0,
} as const;
