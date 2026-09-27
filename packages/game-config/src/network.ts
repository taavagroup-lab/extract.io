export const NETWORK_CONFIG = {
  /** Server simulation ticks per second. Clients simulate input at the same rate. */
  tickRate: 30,
  /** Send a snapshot every N ticks (30 / 2 = 15 Hz). */
  snapshotEveryTicks: 2,
  /** Remote entities are rendered this far in the past. */
  interpolationDelayMs: 110,
  /** Logical view the client camera shows (it zooms to fit the screen). */
  view: { width: 1600, height: 1000 },
  /** Interest area half-extents around a player (a bit larger than half the view). */
  interest: { halfWidth: 1000, halfHeight: 720 },
  /** Cell size of the spatial hash used for interest management and hit queries. */
  spatialCellSize: 256,
  input: {
    /** Inputs queued beyond this are dropped. */
    maxQueue: 20,
    /** Max simulated time a client may bank (catch-up after jitter). */
    maxBudgetMs: 250,
    maxBatch: 8,
  },
  rateLimit: {
    messagesPerSecond: 120,
    burst: 240,
    /** Disconnect after this many dropped messages within a window. */
    maxViolations: 300,
  },
  maxMessageBytes: 8192,
  reconnectWindowMs: 20_000,
  pingIntervalMs: 2_000,
} as const;
