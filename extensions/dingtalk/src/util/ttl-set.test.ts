import { describe, expect, it } from "vitest";
import { TtlSet } from "./ttl-set.js";

describe("TtlSet", () => {
  it("marks duplicates within TTL", () => {
    const set = new TtlSet({ ttlMs: 1000, maxSize: 100, sweepEvery: 10 });
    expect(set.seen("msg-1", 0)).toBe(false);
    expect(set.seen("msg-1", 999)).toBe(true);
    expect(set.seen("msg-1", 1001)).toBe(false);
  });

  it("ignores empty keys", () => {
    const set = new TtlSet({ ttlMs: 1000, maxSize: 100, sweepEvery: 10 });
    expect(set.seen("", 0)).toBe(false);
    expect(set.seen("   ", 0)).toBe(false);
    expect(set.size()).toBe(0);
  });

  it("evicts to max size by insertion order", () => {
    const set = new TtlSet({ ttlMs: 10_000, maxSize: 2, sweepEvery: 10 });
    expect(set.seen("a", 0)).toBe(false);
    expect(set.seen("b", 0)).toBe(false);
    expect(set.size()).toBe(2);

    // Adding a new entry should evict "a"
    expect(set.seen("c", 0)).toBe(false);
    expect(set.size()).toBe(2);
    expect(set.seen("a", 1)).toBe(false);
  });
});

