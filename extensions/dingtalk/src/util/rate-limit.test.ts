import { describe, expect, it } from "vitest";
import { RollingWindowRateLimiter } from "./rate-limit.js";

describe("RollingWindowRateLimiter", () => {
  it("allows up to (maxRequests + burst) within the window", () => {
    const limiter = new RollingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
      burst: 1,
      maxKeys: 100,
      sweepEvery: 10,
    });

    expect(limiter.allow("u", 0)).toBe(true);
    expect(limiter.allow("u", 1)).toBe(true);
    expect(limiter.allow("u", 2)).toBe(true);
    expect(limiter.allow("u", 3)).toBe(false);
  });

  it("resets after window passes", () => {
    const limiter = new RollingWindowRateLimiter({
      windowMs: 1000,
      maxRequests: 1,
      burst: 0,
      maxKeys: 100,
      sweepEvery: 10,
    });

    expect(limiter.allow("u", 0)).toBe(true);
    expect(limiter.allow("u", 100)).toBe(false);
    expect(limiter.allow("u", 1200)).toBe(true);
  });

  it("treats empty keys as allowed", () => {
    const limiter = new RollingWindowRateLimiter({
      windowMs: 1000,
      maxRequests: 0,
      burst: 0,
      maxKeys: 100,
      sweepEvery: 10,
    });
    expect(limiter.allow("", 0)).toBe(true);
    expect(limiter.allow(undefined, 0)).toBe(true);
  });
});

