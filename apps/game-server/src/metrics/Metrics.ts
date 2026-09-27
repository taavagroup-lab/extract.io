export interface MetricsSnapshot {
  uptimeSeconds: number;
  rooms: number;
  connectedClients: number;
  playersInWorld: number;
  bots: number;
  tick: { rate: number; avgMs: number; p95Ms: number; maxMs: number };
  messagesInPerSecond: number;
  messagesOutPerSecond: number;
  bytesInPerSecond: number;
  bytesOutPerSecond: number;
  memoryMb: { rss: number; heapUsed: number; heapTotal: number };
  pendingPersistenceJobs: number;
}

/** Lightweight in-process server metrics (exposed at GET /metrics). */
export class Metrics {
  messagesIn = 0;
  messagesOut = 0;
  bytesIn = 0;
  bytesOut = 0;
  connectedClients = 0;
  private readonly tickDurations: number[] = [];
  private ticksThisSecond = 0;
  private readonly started = Date.now();
  private rates = { tick: 0, msgIn: 0, msgOut: 0, bytesIn: 0, bytesOut: 0 };
  private last = { msgIn: 0, msgOut: 0, bytesIn: 0, bytesOut: 0 };
  private readonly timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.roll(), 1000);
    this.timer.unref();
  }

  recordTick(ms: number): void {
    this.tickDurations.push(ms);
    if (this.tickDurations.length > 300) this.tickDurations.shift();
    this.ticksThisSecond++;
  }

  private roll(): void {
    this.rates = {
      tick: this.ticksThisSecond,
      msgIn: this.messagesIn - this.last.msgIn,
      msgOut: this.messagesOut - this.last.msgOut,
      bytesIn: this.bytesIn - this.last.bytesIn,
      bytesOut: this.bytesOut - this.last.bytesOut,
    };
    this.last = { msgIn: this.messagesIn, msgOut: this.messagesOut, bytesIn: this.bytesIn, bytesOut: this.bytesOut };
    this.ticksThisSecond = 0;
  }

  snapshot(extra: { rooms: number; playersInWorld: number; bots: number; pendingPersistenceJobs: number }): MetricsSnapshot {
    const sorted = [...this.tickDurations].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    const p95 = sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0) : 0;
    const mem = process.memoryUsage();
    const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      uptimeSeconds: Math.round((Date.now() - this.started) / 1000),
      rooms: extra.rooms,
      connectedClients: this.connectedClients,
      playersInWorld: extra.playersInWorld,
      bots: extra.bots,
      tick: { rate: this.rates.tick, avgMs: r2(avg), p95Ms: r2(p95), maxMs: r2(sorted[sorted.length - 1] ?? 0) },
      messagesInPerSecond: this.rates.msgIn,
      messagesOutPerSecond: this.rates.msgOut,
      bytesInPerSecond: this.rates.bytesIn,
      bytesOutPerSecond: this.rates.bytesOut,
      memoryMb: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed), heapTotal: mb(mem.heapTotal) },
      pendingPersistenceJobs: extra.pendingPersistenceJobs,
    };
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
