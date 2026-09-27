export interface Vec2 {
  x: number;
  y: number;
}

/** Numeric entity id, unique within one match. Compact on the wire. */
export type EntityId = number;

/** All money values are integer cents of TEST USDC to avoid float drift. */
export type Cents = number;
