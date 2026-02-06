import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  ALIYUN_MCP_API_KEY_ENV_BY_TOOL,
  ALIYUN_MCP_API_KEY_ENV_GLOBAL,
  ALIYUN_MCP_DEFAULT_ENDPOINTS,
  ALIYUN_MCP_DEFAULT_TIMEOUT_SECONDS,
  type AliyunMcpToolId,
} from "./constants.js";

type PlainObject = Record<string, unknown>;

export type AliyunMcpToolConfig = {
  enabled: boolean;
  endpoint: string;
};

export type AliyunMcpWan26ToolConfig = AliyunMcpToolConfig & {
  autoSendToDingtalk: boolean;
};

export type AliyunMcpConfig = {
  apiKey?: string;
  timeoutSeconds: number;
  tools: {
    webSearch: AliyunMcpToolConfig;
    codeInterpreter: AliyunMcpToolConfig;
    webParser: AliyunMcpToolConfig;
    wan26Media: AliyunMcpWan26ToolConfig;
  };
};

function asObject(value: unknown): PlainObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as PlainObject;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function buildToolConfig(raw: PlainObject | undefined, toolId: AliyunMcpToolId): AliyunMcpToolConfig {
  return {
    enabled: readBoolean(raw?.enabled) ?? false,
    endpoint: readString(raw?.endpoint) ?? ALIYUN_MCP_DEFAULT_ENDPOINTS[toolId],
  };
}

export function resolveAliyunMcpConfig(pluginConfig: unknown): AliyunMcpConfig {
  const root = asObject(pluginConfig);
  const aliyunMcp = asObject(root?.aliyunMcp);
  const tools = asObject(aliyunMcp?.tools);

  const webSearch = buildToolConfig(asObject(tools?.webSearch), "webSearch");
  const codeInterpreter = buildToolConfig(asObject(tools?.codeInterpreter), "codeInterpreter");
  const webParser = buildToolConfig(asObject(tools?.webParser), "webParser");
  const wan26MediaRaw = asObject(tools?.wan26Media);
  const wan26Media: AliyunMcpWan26ToolConfig = {
    ...buildToolConfig(wan26MediaRaw, "wan26Media"),
    autoSendToDingtalk: readBoolean(wan26MediaRaw?.autoSendToDingtalk) ?? true,
  };

  const timeoutSeconds = Math.max(
    1,
    Math.floor(readNumber(aliyunMcp?.timeoutSeconds) ?? ALIYUN_MCP_DEFAULT_TIMEOUT_SECONDS),
  );

  return {
    apiKey: readString(aliyunMcp?.apiKey),
    timeoutSeconds,
    tools: {
      webSearch,
      codeInterpreter,
      webParser,
      wan26Media,
    },
  };
}

function readEnvValue(name: string, env: NodeJS.ProcessEnv): string | undefined {
  return readString(env[name]);
}

export function resolveAliyunMcpApiKey(params: {
  toolId: AliyunMcpToolId;
  config: AliyunMcpConfig;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  const env = params.env ?? process.env;
  for (const envName of ALIYUN_MCP_API_KEY_ENV_BY_TOOL[params.toolId]) {
    const fromToolEnv = readEnvValue(envName, env);
    if (fromToolEnv) {
      return fromToolEnv;
    }
  }
  const fromGlobalEnv = readEnvValue(ALIYUN_MCP_API_KEY_ENV_GLOBAL, env);
  if (fromGlobalEnv) {
    return fromGlobalEnv;
  }
  return params.config.apiKey;
}

export function describeAliyunMcpApiKeyHints(toolId: AliyunMcpToolId): string {
  const envNames = [
    ...ALIYUN_MCP_API_KEY_ENV_BY_TOOL[toolId],
    ALIYUN_MCP_API_KEY_ENV_GLOBAL,
    "plugins.entries.clawdbot-dingtalk.config.aliyunMcp.apiKey",
  ];
  return envNames.join(" / ");
}

export function buildAliyunMcpSearchWarnings(params: {
  config: AliyunMcpConfig;
  clawConfig?: OpenClawConfig;
}): string[] {
  const warnings: string[] = [];
  const coreWebSearchEnabled = (params.clawConfig as { tools?: { web?: { search?: { enabled?: boolean } } } })
    ?.tools?.web?.search?.enabled;
  const pluginSearchEnabled = params.config.tools.webSearch.enabled;

  if (!pluginSearchEnabled && coreWebSearchEnabled === false) {
    warnings.push(
      "[dingtalk][aliyun-mcp] Both plugin web_search and core tools.web.search are disabled. No web search tool is available.",
    );
  }

  if (pluginSearchEnabled && coreWebSearchEnabled !== false) {
    warnings.push(
      "[dingtalk][aliyun-mcp] Plugin web_search is enabled but core tools.web.search.enabled is not false. Name conflict may block plugin web_search. Set tools.web.search.enabled=false.",
    );
  }

  return warnings;
}

