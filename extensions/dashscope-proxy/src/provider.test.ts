import { describe, expect, it } from "vitest";

import {
    buildConfigPatch,
    buildModelDefinition,
    normalizeBaseUrl,
    parseModelIds,
} from "./provider.js";

describe("dashscope provider helpers", () => {
    it("normalizes base url with protocol and /v1", () => {
        expect(normalizeBaseUrl("dashscope.aliyuncs.com/compatible-mode/v1")).toBe(
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        );
        expect(normalizeBaseUrl("https://dashscope.aliyuncs.com/compatible-mode")).toBe(
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        );
        expect(normalizeBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1/")).toBe(
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        );
    });

    it("falls back to default model ids", () => {
        const defaults = parseModelIds("");
        expect(defaults.length).toBeGreaterThan(0);
        expect(defaults).toContain("qwen3-max-2026-01-23");
        expect(defaults).toContain("qwen3-coder-plus");
    });

    it("marks thinking models as reasoning-capable", () => {
        const model = buildModelDefinition("qwen3-max-2026-01-23");
        expect(model.reasoning).toBe(true);
        expect(model.compat?.supportsDeveloperRole).toBe(false);
    });

    it("detects vision-capable models by id", () => {
        const model = buildModelDefinition("qwen2-vl");
        expect(model.input).toEqual(["text", "image"]);
    });

    it("builds config patch with provider and agent allowlist", () => {
        const patch = buildConfigPatch({
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            apiKey: "sk-test",
            modelIds: ["qwen3-coder-plus"],
        });
        expect(patch.models.providers.dashscope.baseUrl).toBe(
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        );
        expect(patch.models.providers.dashscope.api).toBe("openai-completions");
        expect(patch.models.providers.dashscope.models[0]?.id).toBe("qwen3-coder-plus");
        expect(patch.agents.defaults.models).toHaveProperty("dashscope/qwen3-coder-plus");
    });
});
