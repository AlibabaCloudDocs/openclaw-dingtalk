import { describe, it, expect } from "vitest";

import { createThinkingChecker } from "./thinking-models.js";

describe("createThinkingChecker", () => {
    it("matches default models", () => {
        const supports = createThinkingChecker();
        expect(supports("qwen-plus")).toBe(true);
        expect(supports("qwq-plus")).toBe(true);
        expect(supports("not-a-thinking-model")).toBe(false);
    });

    it("supports prefix matching (date/version suffix)", () => {
        const supports = createThinkingChecker();
        expect(supports("qwen-plus-2026-01-01")).toBe(true);
    });

    it("overrides defaults with custom list", () => {
        const supports = createThinkingChecker("foo, bar");
        expect(supports("foo")).toBe(true);
        expect(supports("qwen-plus")).toBe(false);
    });
});
