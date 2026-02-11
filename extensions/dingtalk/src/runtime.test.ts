import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  clearCardStreamStates,
  getCardStreamState,
  setCardStreamState,
} from "./runtime.js";

describe("runtime cardStreamCache", () => {
  beforeEach(() => {
    clearCardStreamStates();
  });

  it("evicts oldest entries when exceeding max size", () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    for (let i = 0; i < 5005; i += 1) {
      setCardStreamState(`s${i}`, {
        outTrackId: `t${i}`,
        lastUpdateAt: now,
      });
    }

    // The earliest keys should be evicted.
    expect(getCardStreamState("s0")).toBeUndefined();
    expect(getCardStreamState("s1")).toBeUndefined();
    expect(getCardStreamState("s4")).toBeUndefined();
    expect(getCardStreamState("s5")).toBeDefined();
  });

  it("expires entries by TTL based on lastUpdateAt", () => {
    const base = 2_000_000;
    vi.spyOn(Date, "now").mockReturnValue(base);

    setCardStreamState("old", {
      outTrackId: "t-old",
      lastUpdateAt: base - 25 * 60 * 60 * 1000,
    });
    setCardStreamState("fresh", {
      outTrackId: "t-fresh",
      lastUpdateAt: base,
    });

    // Trigger periodic sweep.
    setCardStreamState("tick", { outTrackId: "t", lastUpdateAt: base });
    for (let i = 0; i < 197; i += 1) {
      getCardStreamState("tick");
    }

    expect(getCardStreamState("old")).toBeUndefined();
    expect(getCardStreamState("fresh")).toBeDefined();
  });
});
