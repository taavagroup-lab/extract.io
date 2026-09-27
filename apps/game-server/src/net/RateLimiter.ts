/** Token bucket: `rate` tokens per second, up to `burst` stored. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number = performance.now(),
  ) {
    this.tokens = burst;
    this.last = now;
  }

  take(now: number = performance.now(), cost = 1): boolean {
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
