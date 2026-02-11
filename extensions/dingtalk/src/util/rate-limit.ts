export type RateLimitConfig = {
  enabled: boolean;
  windowSeconds: number;
  maxRequests: number;
  burst: number;
  bypassUsers: string[];
  replyOnLimit: boolean;
  limitMessage: string;
};

export type RateLimiterOptions = {
  windowMs: number;
  maxRequests: number;
  burst: number;
  maxKeys: number;
  sweepEvery: number;
};

/**
 * Rolling-window per-key limiter.
 *
 * Implementation: keep timestamps for each key and allow up to (maxRequests + burst)
 * within the last windowMs.
 */
export class RollingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly limit: number;
  private readonly maxKeys: number;
  private readonly sweepEvery: number;
  private ops = 0;

  private readonly byKey = new Map<string, number[]>();

  constructor(opts: RateLimiterOptions) {
    if (opts.windowMs <= 0) throw new Error("windowMs must be > 0");
    if (opts.maxRequests < 0) throw new Error("maxRequests must be >= 0");
    if (opts.burst < 0) throw new Error("burst must be >= 0");
    if (opts.maxKeys <= 0) throw new Error("maxKeys must be > 0");
    if (opts.sweepEvery <= 0) throw new Error("sweepEvery must be > 0");

    this.windowMs = opts.windowMs;
    this.limit = Math.max(0, Math.floor(opts.maxRequests) + Math.floor(opts.burst));
    this.maxKeys = opts.maxKeys;
    this.sweepEvery = opts.sweepEvery;
  }

  allow(key: string | undefined | null, nowMs: number = Date.now()): boolean {
    const normalized = typeof key === "string" ? key.trim() : "";
    if (!normalized) return true;
    if (this.limit === 0) return false;

    this.ops += 1;
    if (this.ops % this.sweepEvery === 0) {
      this.sweep(nowMs);
    }

    const cutoff = nowMs - this.windowMs;
    const times = this.byKey.get(normalized) ?? [];
    let start = 0;
    while (start < times.length && times[start] <= cutoff) start += 1;
    const recent = start > 0 ? times.slice(start) : times;

    if (recent.length >= this.limit) {
      this.byKey.set(normalized, recent);
      return false;
    }

    recent.push(nowMs);
    this.byKey.set(normalized, recent);
    this.evictToMaxKeys();
    return true;
  }

  private sweep(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    for (const [key, times] of this.byKey.entries()) {
      let start = 0;
      while (start < times.length && times[start] <= cutoff) start += 1;
      if (start >= times.length) {
        this.byKey.delete(key);
      } else if (start > 0) {
        this.byKey.set(key, times.slice(start));
      }
    }
    this.evictToMaxKeys();
  }

  private evictToMaxKeys(): void {
    while (this.byKey.size > this.maxKeys) {
      const first = this.byKey.keys().next().value as string | undefined;
      if (!first) break;
      this.byKey.delete(first);
    }
  }
}

