import type { OpenClawPluginService } from "openclaw/plugin-sdk";

import type { DashScopeProxyConfig, ProxyHandle, ProxyLogger } from "./types.js";
import { createDashScopeProxy } from "./proxy.js";

const DEFAULT_TARGET_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    return undefined;
}

function asNumber(value: unknown): number | undefined {
    if (typeof value !== "number") return undefined;
    if (Number.isNaN(value)) return undefined;
    return value;
}

function asBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    return undefined;
}

function adaptLogger(logger: { info?: (msg: string) => void; debug?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void }): ProxyLogger {
    return {
        info: (obj, msg) => {
            const message = msg ?? (typeof obj === "string" ? obj : JSON.stringify(obj));
            logger.info?.(message);
        },
        debug: (obj, msg) => {
            const message = msg ?? (typeof obj === "string" ? obj : JSON.stringify(obj));
            logger.debug?.(message);
        },
        warn: (obj, msg) => {
            const message = msg ?? (typeof obj === "string" ? obj : JSON.stringify(obj));
            logger.warn?.(message);
        },
        error: (obj, msg) => {
            const message = msg ?? (typeof obj === "string" ? obj : JSON.stringify(obj));
            logger.error?.(message);
        },
    };
}

export function createDashScopeProxyService(params: {
    pluginConfig?: Record<string, unknown>;
}): OpenClawPluginService {
    let proxyHandle: ProxyHandle | null = null;

    return {
        id: "dashscope-thinking-proxy",

        async start(ctx) {
            const cfg = isRecord(params.pluginConfig) ? params.pluginConfig : {};

            const enabled = asBoolean(cfg.enabled) ?? true;
            if (!enabled) {
                ctx.logger.debug?.("[dashscope-proxy] service disabled");
                return;
            }

            const bind = asString(cfg.bind) ?? "127.0.0.1";
            const port = asNumber(cfg.port) ?? 18788;
            const targetBaseUrl = asString(cfg.targetBaseUrl) ?? DEFAULT_TARGET_BASE_URL;
            const thinkingEnabled = asBoolean(cfg.thinkingEnabled) ?? true;
            const thinkingBudget = asNumber(cfg.thinkingBudget) ?? 0;
            const thinkingModels = asString(cfg.thinkingModels);
            const logRequestBody = asBoolean(cfg.logRequestBody) ?? false;

            const logger: ProxyLogger = adaptLogger(ctx.logger);

            try {
                const proxyConfig: DashScopeProxyConfig = {
                    enabled: true,
                    port,
                    bind,
                    targetBaseUrl,
                    thinkingEnabled,
                    thinkingBudget,
                    thinkingModels,
                    logRequestBody,
                };

                proxyHandle = await createDashScopeProxy(proxyConfig, logger);
                ctx.logger.info?.(
                    `[dashscope-proxy] started on ${bind}:${port} (targetBaseUrl=${targetBaseUrl})`
                );
            } catch (err) {
                ctx.logger.error?.(
                    `[dashscope-proxy] failed to start: ${(err as Error)?.message}`
                );
            }
        },

        async stop() {
            if (proxyHandle) {
                await proxyHandle.stop();
                proxyHandle = null;
            }
        },
    };
}
