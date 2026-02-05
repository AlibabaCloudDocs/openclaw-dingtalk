import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { createDashScopeProxy } from "./proxy.js";
import type { DashScopeProxyConfig, ProxyHandle, ProxyLogger } from "./types.js";
import { normalizeBaseUrl } from "./provider.js";

const PLUGIN_ID = "clawdbot-dashscope-proxy";
const DEFAULT_BIND = "127.0.0.1";
const DEFAULT_PORT = 18788;
const DEFAULT_TARGET_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

type RawPluginConfig = Record<string, unknown> | undefined;

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function resolveThinkingModels(config: OpenClawConfig, pluginConfig: RawPluginConfig): string | undefined {
    const explicit = readString(pluginConfig?.thinkingModels);
    if (explicit) return explicit;
    const provider = (config as { models?: { providers?: Record<string, unknown> } }).models?.providers?.dashscope;
    const models = provider && typeof provider === "object"
        ? (provider as { models?: Array<Record<string, unknown>> }).models
        : undefined;
    if (!Array.isArray(models)) return undefined;
    const ids = models
        .filter((entry) => entry && typeof entry === "object" && (entry as { reasoning?: unknown }).reasoning === true)
        .map((entry) => (entry as { id?: unknown }).id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    return ids.length > 0 ? ids.join(",") : undefined;
}

function resolveProxyConfig(config: OpenClawConfig): DashScopeProxyConfig {
    const entry = (config as { plugins?: { entries?: Record<string, unknown> } }).plugins?.entries?.[PLUGIN_ID];
    const pluginConfig =
        entry && typeof entry === "object"
            ? (entry as { config?: Record<string, unknown> }).config
            : undefined;

    const bind = readString(pluginConfig?.bind) ?? DEFAULT_BIND;
    const port = readNumber(pluginConfig?.port) ?? DEFAULT_PORT;
    const targetBaseUrl = normalizeBaseUrl(readString(pluginConfig?.targetBaseUrl) ?? DEFAULT_TARGET_BASE_URL);
    const thinkingEnabled = readBoolean(pluginConfig?.thinkingEnabled) ?? true;
    const thinkingBudget = readNumber(pluginConfig?.thinkingBudget) ?? 0;
    const thinkingModels = resolveThinkingModels(config, pluginConfig);
    const logRequestBody = readBoolean(pluginConfig?.logRequestBody) ?? false;

    return {
        bind,
        port,
        targetBaseUrl,
        thinkingEnabled,
        thinkingBudget,
        thinkingModels,
        logRequestBody,
    };
}

export function createDashScopeProxyService() {
    let handle: ProxyHandle | null = null;
    return {
        id: "dashscope-proxy",
        async start(ctx: { config: OpenClawConfig; logger: ProxyLogger }) {
            const proxyConfig = resolveProxyConfig(ctx.config);
            handle = await createDashScopeProxy(proxyConfig, ctx.logger);
        },
        async stop(ctx: { logger: ProxyLogger }) {
            if (!handle) return;
            await handle.stop();
            handle = null;
            ctx.logger.info?.({ ok: true }, "DashScope proxy stopped");
        },
    };
}
