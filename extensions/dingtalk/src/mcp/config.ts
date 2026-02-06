import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  ALIYUN_MCP_API_KEY_ENV_BY_TOOL,
  ALIYUN_MCP_API_KEY_ENV_GLOBAL,
  ALIYUN_MCP_DEFAULT_ENDPOINTS,
  ALIYUN_MCP_DEFAULT_TIMEOUT_SECONDS,
  type AliyunMcpToolId,
} from "./constants.js";
import { DINGTALK_CHANNEL_ID } from "../config-schema.js";

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

function buildToolConfig(
  channelConfig: PlainObject | undefined,
  pluginConfig: PlainObject | undefined,
  toolId: AliyunMcpToolId,
): AliyunMcpToolConfig {
  return {
    enabled: readBoolean(channelConfig?.enabled) ?? readBoolean(pluginConfig?.enabled) ?? false,
    endpoint:
      readString(channelConfig?.endpoint) ??
      readString(pluginConfig?.endpoint) ??
      ALIYUN_MCP_DEFAULT_ENDPOINTS[toolId],
  };
}

function readChannelAliyunMcpConfig(params: {
  clawConfig?: OpenClawConfig;
  channelId: string;
}): PlainObject | undefined {
  const root = asObject(params.clawConfig);
  const channels = asObject(root?.channels);
  const fromChannels = asObject(channels?.[params.channelId]);
  const fromLegacyRoot = asObject(root?.[params.channelId]);
  const channelSection = fromChannels ?? fromLegacyRoot;
  return asObject(channelSection?.aliyunMcp);
}

export function resolveAliyunMcpConfig(
  pluginConfig: unknown,
  options?: { clawConfig?: OpenClawConfig; channelId?: string },
): AliyunMcpConfig {
  const pluginRoot = asObject(pluginConfig);
  const pluginAliyunMcp = asObject(pluginRoot?.aliyunMcp);
  const channelAliyunMcp = readChannelAliyunMcpConfig({
    clawConfig: options?.clawConfig,
    channelId: options?.channelId ?? DINGTALK_CHANNEL_ID,
  });

  const channelTools = asObject(channelAliyunMcp?.tools);
  const pluginTools = asObject(pluginAliyunMcp?.tools);

  const webSearch = buildToolConfig(
    asObject(channelTools?.webSearch),
    asObject(pluginTools?.webSearch),
    "webSearch",
  );
  const codeInterpreter = buildToolConfig(
    asObject(channelTools?.codeInterpreter),
    asObject(pluginTools?.codeInterpreter),
    "codeInterpreter",
  );
  const webParser = buildToolConfig(
    asObject(channelTools?.webParser),
    asObject(pluginTools?.webParser),
    "webParser",
  );
  const wan26MediaChannel = asObject(channelTools?.wan26Media);
  const wan26MediaPlugin = asObject(pluginTools?.wan26Media);
  const wan26Media: AliyunMcpWan26ToolConfig = {
    ...buildToolConfig(wan26MediaChannel, wan26MediaPlugin, "wan26Media"),
    autoSendToDingtalk:
      readBoolean(wan26MediaChannel?.autoSendToDingtalk) ??
      readBoolean(wan26MediaPlugin?.autoSendToDingtalk) ??
      true,
  };

  const timeoutSeconds = Math.max(
    1,
    Math.floor(
      readNumber(channelAliyunMcp?.timeoutSeconds) ??
        readNumber(pluginAliyunMcp?.timeoutSeconds) ??
        ALIYUN_MCP_DEFAULT_TIMEOUT_SECONDS,
    ),
  );

  return {
    apiKey: readString(channelAliyunMcp?.apiKey) ?? readString(pluginAliyunMcp?.apiKey),
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
    `channels.${DINGTALK_CHANNEL_ID}.aliyunMcp.apiKey`,
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
