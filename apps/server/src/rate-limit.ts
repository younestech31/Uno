export interface RateLimiterOptions {
  readonly windowMs: number;
  readonly maxEvents: number;
}

export const DEFAULT_RATE_LIMIT: RateLimiterOptions = {
  windowMs: 1000,
  maxEvents: 20,
};

/**
 * Per-socket sliding-window rate limiter.
 */
export class SocketRateLimiter {
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(options?: Partial<RateLimiterOptions>) {
    this.windowMs = options?.windowMs ?? DEFAULT_RATE_LIMIT.windowMs;
    this.maxEvents = options?.maxEvents ?? DEFAULT_RATE_LIMIT.maxEvents;
  }

  /**
   * Returns true if the event is allowed for `key` (e.g. socket connection key),
   * or false if the rate limit is exceeded.
   */
  public consume(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const existing = this.buckets.get(key) ?? [];
    const active = existing.filter((ts) => ts > cutoff);

    if (active.length >= this.maxEvents) {
      this.buckets.set(key, active);
      return false;
    }

    active.push(now);
    this.buckets.set(key, active);
    return true;
  }

  public remove(key: string): void {
    this.buckets.delete(key);
  }

  public clear(): void {
    this.buckets.clear();
  }
}
