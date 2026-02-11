export type TtlSetOptions = {
  ttlMs: number;
  maxSize: number;
  sweepEvery: number;
};

/**
 * A small in-memory TTL set with bounded size.
 *
 * Intended for best-effort deduplication (e.g. DingTalk Stream redeliveries).
 * Uses insertion order eviction when maxSize is exceeded.
 */
export class TtlSet {
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly sweepEvery: number;
  private readonly map = new Map<string, number>(); // key -> expiresAtMs
  private ops = 0;

  constructor(opts: TtlSetOptions) {
    if (opts.ttlMs <= 0) throw new Error("ttlMs must be > 0");
    if (opts.maxSize <= 0) throw new Error("maxSize must be > 0");
    if (opts.sweepEvery <= 0) throw new Error("sweepEvery must be > 0");
    this.ttlMs = opts.ttlMs;
    this.maxSize = opts.maxSize;
    this.sweepEvery = opts.sweepEvery;
  }

  size(): number {
    return this.map.size;
  }

  /**
   * Returns true when the key is a duplicate within TTL, otherwise records it and returns false.
   */
  seen(key: string | undefined | null, nowMs: number = Date.now()): boolean {
    const normalized = typeof key === "string" ? key.trim() : "";
    if (!normalized) return false;

    this.ops += 1;
    if (this.ops % this.sweepEvery === 0) {
      this.sweep(nowMs);
    }

    const expiresAt = this.map.get(normalized);
    if (typeof expiresAt === "number" && expiresAt > nowMs) {
      return true;
    }

    this.map.set(normalized, nowMs + this.ttlMs);
    this.evictToMaxSize();
    return false;
  }

  private sweep(nowMs: number): void {
    for (const [k, expiresAt] of this.map.entries()) {
      if (expiresAt <= nowMs) {
        this.map.delete(k);
      }
    }
    this.evictToMaxSize();
  }

  private evictToMaxSize(): void {
    while (this.map.size > this.maxSize) {
      const first = this.map.keys().next().value as string | undefined;
      if (!first) break;
      this.map.delete(first);
    }
  }
}

