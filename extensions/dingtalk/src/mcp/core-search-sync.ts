import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { resolveAliyunMcpConfig } from "./config.js";
import { getDingTalkRuntime } from "../runtime.js";

type LoggerLike = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type CoreSearchSyncResult =
  | "skipped_web_search_disabled"
  | "already_disabled"
  | "cooldown"
  | "in_flight"
  | "updated"
  | "failed";

const SUCCESS_COOLDOWN_MS = 5000;

let syncInFlight: Promise<void> | null = null;
let lastSuccessAt = 0;
let lastConflictWarnAt = 0;

function isCoreWebSearchDisabled(cfg?: OpenClawConfig): boolean {
  return (cfg as { tools?: { web?: { search?: { enabled?: boolean } } } })?.tools?.web?.search
    ?.enabled === false;
}

function withCoreWebSearchDisabled(cfg: OpenClawConfig): OpenClawConfig {
  const tools = (cfg?.tools ?? {}) as Record<string, unknown>;
  const web = ((tools.web as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const search = ((web.search as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  return {
    ...cfg,
    tools: {
      ...tools,
      web: {
        ...web,
        search: {
          ...search,
          enabled: false,
        },
      },
    },
  } as OpenClawConfig;
}

export async function ensureCoreWebSearchDisabledForAliyun(params: {
  pluginConfig: unknown;
  clawConfig?: OpenClawConfig;
  logger?: LoggerLike;
  runtime?: PluginRuntime;
  reason?: string;
}): Promise<CoreSearchSyncResult> {
  const resolved = resolveAliyunMcpConfig(params.pluginConfig, {
    clawConfig: params.clawConfig,
  });
  if (!resolved.tools.webSearch.enabled) {
    return "skipped_web_search_disabled";
  }

  if (isCoreWebSearchDisabled(params.clawConfig)) {
    return "already_disabled";
  }

  const now = Date.now();
  if (syncInFlight) {
    return "in_flight";
  }
  if (lastSuccessAt > 0 && now - lastSuccessAt < SUCCESS_COOLDOWN_MS) {
    return "cooldown";
  }

  if (now - lastConflictWarnAt > SUCCESS_COOLDOWN_MS) {
    params.logger?.warn?.(
      "[dingtalk][aliyun-mcp] Aliyun web_search is enabled while core tools.web.search.enabled is not false. Attempting to auto-disable core web_search.",
    );
    lastConflictWarnAt = now;
  }

  try {
    const runtime = params.runtime ?? getDingTalkRuntime();
    const latestConfig = runtime.config.loadConfig();
    if (isCoreWebSearchDisabled(latestConfig)) {
      lastSuccessAt = Date.now();
      return "already_disabled";
    }

    const nextConfig = withCoreWebSearchDisabled(latestConfig);
    syncInFlight = runtime.config.writeConfigFile(nextConfig);
    await syncInFlight;
    lastSuccessAt = Date.now();
    params.logger?.info?.(
      `[dingtalk][aliyun-mcp] Auto-disabled core tools.web.search.enabled=false (${params.reason ?? "unknown_reason"}).`,
    );
    return "updated";
  } catch (error) {
    params.logger?.warn?.(
      `[dingtalk][aliyun-mcp] Failed to auto-disable core web_search: ${String(error)}`,
    );
    return "failed";
  } finally {
    syncInFlight = null;
  }
}

export const __testing = {
  resetCoreSearchSyncState() {
    syncInFlight = null;
    lastSuccessAt = 0;
    lastConflictWarnAt = 0;
  },
};
