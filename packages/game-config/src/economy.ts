export const ECONOMY_CONFIG = {
  currency: 'TEST_USDC',
  /** New accounts start with this balance (cents). */
  startingBalanceCents: 5_000,
  marketplace: {
    /** 500 bps = 5 %. */
    feeBps: 500,
    minPriceCents: 1,
    maxPriceCents: 100_000_000,
    maxActiveListingsPerUser: 50,
  },
  death: {
    /** Share of the (non secure-slot) bag that drops on the ground. */
    dropRatio: 0.7,
    /** Share of the bag value that is automatically secured on death. */
    autoSecureRatio: 0.3,
    /**
     * Items are discrete; when the random item selection cannot reach the
     * auto-secure target exactly, the remainder is paid out as TEST USDC.
     */
    insurancePayout: true,
  },
  /** Players still in the raid when the timer hits 10:00 only keep their secure slot. */
  timeoutKeepsAutoSecure: false,
  bounty: {
    thresholdKills: 5,
    /** Bounty for 5, 6, 7, 8 kills. */
    tableCents: [500, 800, 1200, 1800] as const,
    /** Beyond the table each extra kill multiplies the bounty. */
    growthMultiplier: 1.5,
    positionFuzzRadius: 260,
  },
} as const;
