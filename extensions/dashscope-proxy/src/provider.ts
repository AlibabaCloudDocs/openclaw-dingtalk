import { createThinkingChecker } from "./thinking-models.js";

type ModelCompatConfig = {
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
};

type ModelDefinitionConfig = {
    id: string;
    name: string;
    reasoning: boolean;
    input: Array<"text" | "image">;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
    compat?: ModelCompatConfig;
};

const PROVIDER_ID = "dashscope";
const PROVIDER_LABEL = "DashScope";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL_IDS = ["qwen3-max-2026-01-23", "qwen3-coder-plus"] as const;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8192;

const MODEL_PRESETS: Record<
    string,
    {
        name: string;
        contextWindow: number;
        maxTokens: number;
        reasoning?: boolean;
        compat?: ModelCompatConfig;
    }
> = {
    "qwen3-max-2026-01-23": {
        name: "Qwen3 Max Thinking",
        contextWindow: 262_144,
        maxTokens: 32_768,
        reasoning: true,
        compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
        },
    },
    "qwen3-coder-plus": {
        name: "Qwen3 Coder Plus",
        contextWindow: 1_000_000,
        maxTokens: 65_536,
    },
};

const THINKING_MODELS = createThinkingChecker();

function ensureUrlProtocol(raw: string): string {
    if (!raw) {
        return DEFAULT_BASE_URL;
    }
    return raw.startsWith("http") ? raw : `https://${raw}`;
}

export function normalizeBaseUrl(value?: string | null): string {
    const raw = (value ?? "").trim() || DEFAULT_BASE_URL;
    const withProtocol = ensureUrlProtocol(raw);
    const stripped = withProtocol.replace(/\/+$/, "");
    return stripped.endsWith("/v1") ? stripped : `${stripped}/v1`;
}

export function parseModelIds(value?: string | null): string[] {
    const raw = (value ?? "").trim();
    if (!raw) {
        return [...DEFAULT_MODEL_IDS];
    }
    const parsed = raw
        .split(/[\n,]/)
        .map((model) => model.trim())
        .filter(Boolean);
    return parsed.length > 0 ? Array.from(new Set(parsed)) : [...DEFAULT_MODEL_IDS];
}

export function resolveModelInput(modelId: string): Array<"text" | "image"> {
    const lowered = modelId.toLowerCase();
    if (lowered.includes("-vl") || lowered.includes("vision") || lowered.includes("multimodal")) {
        return ["text", "image"];
    }
    return ["text"];
}

export function buildModelDefinition(modelId: string): ModelDefinitionConfig {
    const preset = MODEL_PRESETS[modelId];
    const reasoning = preset?.reasoning ?? THINKING_MODELS(modelId);
    return {
        id: modelId,
        name: preset?.name ?? modelId,
        reasoning,
        input: resolveModelInput(modelId),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: preset?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: preset?.maxTokens ?? DEFAULT_MAX_TOKENS,
        compat: preset?.compat,
    };
}

export function buildConfigPatch(params: { baseUrl: string; apiKey: string; modelIds: string[] }) {
    return {
        models: {
            providers: {
                [PROVIDER_ID]: {
                    baseUrl: params.baseUrl,
                    apiKey: params.apiKey,
                    api: "openai-completions",
                    models: params.modelIds.map((modelId) => buildModelDefinition(modelId)),
                },
            },
        },
        agents: {
            defaults: {
                models: Object.fromEntries(
                    params.modelIds.map((modelId) => [`${PROVIDER_ID}/${modelId}`, {}]),
                ),
            },
        },
    };
}

export function createDashScopeProvider() {
    return {
        id: PROVIDER_ID,
        label: PROVIDER_LABEL,
        docsPath: "/providers/models",
        aliases: ["qwen", "dashscope"],
        auth: [
            {
                id: "api-key",
                label: "DashScope API Key",
                hint: "Configure DashScope base URL + models",
                kind: "custom",
                run: async (ctx: any) => {
                    const apiKey = await ctx.prompter.text({
                        message: "DashScope API Key",
                        validate: (value: string) =>
                            value && value.trim().length > 0 ? undefined : "API key required",
                    });

                    const baseUrlInput = await ctx.prompter.text({
                        message: "DashScope base URL",
                        initialValue: DEFAULT_BASE_URL,
                        validate: (value: string) => {
                            try {
                                new URL(normalizeBaseUrl(value));
                                return undefined;
                            } catch {
                                return "Enter a valid URL";
                            }
                        },
                    });

                    const modelInput = await ctx.prompter.text({
                        message: "Model IDs (comma-separated)",
                        initialValue: DEFAULT_MODEL_IDS.join(", "),
                        validate: (value: string) =>
                            parseModelIds(value).length > 0 ? undefined : "Enter at least one model id",
                    });

                    const baseUrl = normalizeBaseUrl(baseUrlInput);
                    const modelIds = parseModelIds(modelInput);
                    const defaultModelId = modelIds[0] ?? DEFAULT_MODEL_IDS[0];
                    const defaultModelRef = `${PROVIDER_ID}/${defaultModelId}`;

                    return {
                        profiles: [
                            {
                                profileId: `${PROVIDER_ID}:default`,
                                credential: {
                                    type: "api_key",
                                    provider: PROVIDER_ID,
                                    key: apiKey,
                                },
                            },
                        ],
                        configPatch: buildConfigPatch({ baseUrl, apiKey, modelIds }),
                        defaultModel: defaultModelRef,
                        notes: [
                            "Thinking mode is controlled by /think in OpenClaw (no proxy required).",
                            "Base URL should point to DashScope's OpenAI-compatible endpoint.",
                        ],
                    };
                },
            },
        ],
    };
}

