import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { invokeAliyunMcpTool } from "./client.js";
import {
  buildAliyunMcpSearchWarnings,
  describeAliyunMcpApiKeyHints,
  resolveAliyunMcpApiKey,
  resolveAliyunMcpConfig,
  type AliyunMcpConfig,
} from "./config.js";
import { ALIYUN_MCP_PLUGIN_TOOL_NAMES, type AliyunMcpToolId } from "./constants.js";
import { autoSendWan26MediaToDingtalk } from "./wan26-auto-reply.js";
import { ensureCoreWebSearchDisabledForAliyun } from "./core-search-sync.js";

type LoggerLike = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type ToolContext = {
  config?: OpenClawConfig;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
};

export type AliyunMcpToolRegistration = {
  name: string;
  factory: (ctx: ToolContext) => {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (toolCallId: string, args: unknown) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: unknown;
    }>;
  } | null | undefined;
};

export type AliyunMcpRegistrationResult = {
  config: AliyunMcpConfig;
  tools: AliyunMcpToolRegistration[];
  warnings: string[];
};

const GenericArgsSchema = Type.Object(
  {
    arguments: Type.Optional(
      Type.Object({}, { description: "Pass-through arguments for remote MCP tool", additionalProperties: true }),
    ),
  },
  { additionalProperties: true },
);

const WebSearchSchema = Type.Object(
  {
    query: Type.String({ description: "Search query string." }),
    count: Type.Optional(
      Type.Number({
        description: "Number of results to return (1-10).",
        minimum: 1,
        maximum: 10,
      }),
    ),
    country: Type.Optional(
      Type.String({
        description: "2-letter country code for region-specific results (e.g., 'CN', 'US').",
      }),
    ),
    search_lang: Type.Optional(
      Type.String({
        description: "ISO language code for search results (e.g., 'zh', 'en').",
      }),
    ),
    ui_lang: Type.Optional(
      Type.String({
        description: "ISO language code for UI elements.",
      }),
    ),
    freshness: Type.Optional(
      Type.String({
        description: "Time filter (provider dependent).",
      }),
    ),
  },
  { additionalProperties: true },
);

const Wan26Schema = Type.Object(
  {
    mode: Type.Optional(
      Type.Union([
        Type.Literal("image"),
        Type.Literal("video"),
        Type.Literal("task_status"),
      ]),
    ),
    prompt: Type.Optional(Type.String({ description: "Prompt for image/video generation." })),
    task_id: Type.Optional(
      Type.String({ description: "Task ID for polling asynchronous generation result." }),
    ),
    remoteToolName: Type.Optional(
      Type.String({
        description:
          "Optional exact remote MCP tool name (for example modelstudio_wanx26_image_generation).",
      }),
    ),
    toolName: Type.Optional(
      Type.String({
        description:
          "Alias of remoteToolName. Use only when you need to force a specific remote MCP method.",
      }),
    ),
    arguments: Type.Optional(
      Type.Object(
        {},
        {
          description:
            "Pass-through arguments for remote Wan2.6 MCP tool. Preferred for provider-native payloads.",
          additionalProperties: true,
        },
      ),
    ),
  },
  { additionalProperties: true },
);

const MCP_SHARED_EXECUTION_CONTRACT = [
  "Execution contract:",
  "1) Availability first. If this tool is unavailable (disabled, not activated in Bailian, or missing API key), briefly explain that and continue with a clear fallback instead of stalling.",
  "2) Reliability. Retry only transient failures (network timeout, 429, 5xx, temporary upstream errors). Do not retry auth or invalid-parameter errors.",
  "3) Result discipline. Report key fields from tool output and never claim success before the tool reports success.",
].join("\n");

const WEB_SEARCH_DESCRIPTION = [
  "Search the web through Aliyun DashScope MCP WebSearch endpoint. Replaces default Brave web_search when core search is disabled.",
  "Use this for time-sensitive facts.",
  MCP_SHARED_EXECUTION_CONTRACT,
  "Fallback policy: if unavailable, explicitly say web search is currently unavailable and continue with best-effort reasoning from existing context while marking uncertainty.",
].join("\n\n");

const CODE_INTERPRETER_DESCRIPTION = [
  "Run remote code-interpreter tasks through Aliyun DashScope MCP. Pass parameters directly or via arguments object.",
  "This tool may take longer than regular API calls. Wait for actual tool output before saying computation is complete.",
  MCP_SHARED_EXECUTION_CONTRACT,
  "Fallback policy: if unavailable, continue with manual reasoning, formulas, or pseudo-code and clearly label limitations.",
].join("\n\n");

const WEB_PARSER_DESCRIPTION = [
  "Parse and extract web content through Aliyun DashScope MCP WebParser. Pass parameters directly or via arguments object.",
  "Input must be a publicly reachable HTTP/HTTPS URL. Login-only pages or blocked pages can fail.",
  MCP_SHARED_EXECUTION_CONTRACT,
  "Fallback policy: if parsing fails or tool is unavailable, explain likely causes (login required, anti-bot, invalid URL), suggest a public URL or ask user to paste the raw page content.",
].join("\n\n");

const WAN26_MEDIA_DESCRIPTION = [
  "Generate image/video through Aliyun DashScope MCP Wan2.6. Supports optional auto-send back to current DingTalk session.",
  "Routing rule: when user asks for drawing/photo/image, use image generation first; only use video generation when user explicitly requests video.",
  "You can pass mode=image|video|task_status. If mode is omitted, image is the safe default for drawing/photo requests.",
  "When sending media tags in DingTalk, remote image URLs must be downloaded to a local file first. Only use [DING:IMAGE path=\"/absolute/local/path.png\"].",
  "Wan2.6 tasks can be asynchronous (submit task then fetch result). Treat generation as incomplete until final fetch reports completion.",
  MCP_SHARED_EXECUTION_CONTRACT,
  "Fallback policy: if unavailable, do not pretend media is generated; provide prompt refinement and execution steps the user can run after enabling the tool.",
  "Auth failures (HTTP 401/403) are non-retryable until API key/activation is fixed.",
].join("\n\n");

const WAN26_BAILIAN_DETAIL_URL =
  "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/mcp-market/detail/Wan26Media";
const WAN26_LOCAL_META_KEYS = new Set(["mode", "intent", "remoteToolName", "toolName", "mcpToolName"]);

function normalizeRemoteArgs(params: Record<string, unknown>): Record<string, unknown> {
  const nested = params.arguments;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return params;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveWan26PreferredRemoteToolName(
  allArgs: Record<string, unknown>,
  normalizedArgs: Record<string, unknown>,
): string | undefined {
  return (
    readString(allArgs.remoteToolName) ??
    readString(allArgs.toolName) ??
    readString(allArgs.mcpToolName) ??
    readString(normalizedArgs.remoteToolName) ??
    readString(normalizedArgs.toolName) ??
    readString(normalizedArgs.mcpToolName)
  );
}

function sanitizeWan26RemoteArgs(normalizedArgs: Record<string, unknown>): Record<string, unknown> {
  const copied = { ...normalizedArgs };
  for (const key of WAN26_LOCAL_META_KEYS) {
    delete copied[key];
  }
  return copied;
}

function jsonResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

function isToolError(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return false;
  }
  return (result as { isError?: boolean }).isError === true;
}

function makeMissingApiKeyPayload(toolId: AliyunMcpToolId) {
  const toolName = ALIYUN_MCP_PLUGIN_TOOL_NAMES[toolId];
  return {
    ok: false,
    error: "missing_mcp_api_key",
    message:
      `百炼 MCP 工具缺少 API Key（${toolName}）。` +
      `注意：不会读取 models.providers.dashscope.apiKey。` +
      `请配置以下任一项：${describeAliyunMcpApiKeyHints(toolId)}。` +
      `例如：openclaw config set channels.clawdbot-dingtalk.aliyunMcp.apiKey <API_KEY>`,
  };
}

function parseHttpStatusFromError(error: unknown): number | undefined {
  const text = String(error);
  const patterns = [
    /\(HTTP\s*(\d{3})\)/i,
    /\bHTTP\s*(\d{3})\b/i,
    /\bstatus(?:\s*code)?\s*[:=]\s*(\d{3})\b/i,
    /"status"\s*:\s*(\d{3})/i,
  ];
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    if (!matched) {
      continue;
    }
    const parsed = Number(matched[1]);
    if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) {
      return parsed;
    }
  }
  return undefined;
}

function buildMcpCallFailurePayload(params: {
  error: unknown;
  toolId: AliyunMcpToolId;
  toolName: string;
  endpoint: string;
}) {
  const rawMessage = String(params.error);
  const lower = rawMessage.toLowerCase();
  const httpStatus = parseHttpStatusFromError(params.error);
  const hints = [`API Key 配置项：${describeAliyunMcpApiKeyHints(params.toolId)}`];

  if (params.toolId === "wan26Media") {
    hints.push(`万相 MCP 开通入口：${WAN26_BAILIAN_DETAIL_URL}`);
  }

  if (httpStatus === 401 || httpStatus === 403 || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return {
      ok: false,
      error: "mcp_auth_failed",
      tool: params.toolName,
      endpoint: params.endpoint,
      httpStatus: httpStatus ?? (lower.includes("forbidden") ? 403 : 401),
      retryable: false,
      message: `${params.toolName} authentication failed. Verify API key and MCP activation before retrying.`,
      hints,
      rawError: rawMessage,
    };
  }

  if (httpStatus === 400 || lower.includes("invalid") || lower.includes("bad request")) {
    return {
      ok: false,
      error: "mcp_invalid_arguments",
      tool: params.toolName,
      endpoint: params.endpoint,
      httpStatus: httpStatus ?? 400,
      retryable: false,
      message: `${params.toolName} rejected arguments. Check parameter names/types and retry with corrected payload.`,
      rawError: rawMessage,
    };
  }

  if (httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)) {
    return {
      ok: false,
      error: "mcp_transient_failed",
      tool: params.toolName,
      endpoint: params.endpoint,
      httpStatus,
      retryable: true,
      message: `${params.toolName} temporary upstream failure. Retry after a short delay.`,
      rawError: rawMessage,
    };
  }

  return {
    ok: false,
    error: "mcp_call_failed",
    tool: params.toolName,
    endpoint: params.endpoint,
    message: rawMessage,
    retryable: false,
  };
}

function createToolFactory(params: {
  toolId: AliyunMcpToolId;
  label: string;
  description: string;
  parameters: unknown;
  pluginConfig: unknown;
  clawConfig?: OpenClawConfig;
  logger?: LoggerLike;
}) {
  const pluginToolName = ALIYUN_MCP_PLUGIN_TOOL_NAMES[params.toolId];
  const resolveActiveConfig = (ctxConfig?: OpenClawConfig) =>
    resolveAliyunMcpConfig(params.pluginConfig, {
      clawConfig: ctxConfig ?? params.clawConfig,
    });

  return (ctx: ToolContext) => {
    const activeConfig = resolveActiveConfig(ctx.config);
    if (!activeConfig.tools[params.toolId].enabled) {
      return null;
    }

    if (params.toolId === "webSearch") {
      void ensureCoreWebSearchDisabledForAliyun({
        pluginConfig: params.pluginConfig,
        clawConfig: ctx.config ?? params.clawConfig,
        logger: params.logger,
        reason: "tool_factory",
      });
    }

    return {
      name: pluginToolName,
      label: params.label,
      description: params.description,
      parameters: params.parameters,
      execute: async (_toolCallId: string, args: unknown) => {
        const executionConfig = resolveActiveConfig(ctx.config);
        const executionToolConfig = executionConfig.tools[params.toolId];
        if (!executionToolConfig.enabled) {
          return jsonResult({
            ok: false,
            error: "tool_disabled",
            tool: pluginToolName,
            message: `${pluginToolName} is currently disabled by aliyunMcp config.`,
          });
        }

        if (params.toolId === "webSearch") {
          void ensureCoreWebSearchDisabledForAliyun({
            pluginConfig: params.pluginConfig,
            clawConfig: ctx.config ?? params.clawConfig,
            logger: params.logger,
            reason: "tool_execute",
          });
        }

        const apiKey = resolveAliyunMcpApiKey({
          toolId: params.toolId,
          config: executionConfig,
        });
        if (!apiKey) {
          return jsonResult(makeMissingApiKeyPayload(params.toolId));
        }

        const allArgs = (args ?? {}) as Record<string, unknown>;
        const normalizedArgs = params.toolId === "webSearch" ? allArgs : normalizeRemoteArgs(allArgs);
        const wan26PreferredRemoteToolName =
          params.toolId === "wan26Media"
            ? resolveWan26PreferredRemoteToolName(allArgs, normalizedArgs)
            : undefined;
        const remoteArgs =
          params.toolId === "wan26Media" ? sanitizeWan26RemoteArgs(normalizedArgs) : normalizedArgs;

        try {
          const invoked = await invokeAliyunMcpTool({
            toolId: params.toolId,
            endpoint: executionToolConfig.endpoint,
            apiKey,
            timeoutSeconds: executionConfig.timeoutSeconds,
            arguments: remoteArgs,
            selectionArguments: allArgs,
            preferredRemoteToolName: wan26PreferredRemoteToolName,
            logger: params.logger,
          });

          let wan26AutoSend;
          if (params.toolId === "wan26Media" && executionConfig.tools.wan26Media.autoSendToDingtalk) {
            wan26AutoSend = await autoSendWan26MediaToDingtalk({
              payload: invoked.result,
              config: ctx.config,
              messageChannel: ctx.messageChannel,
              sessionKey: ctx.sessionKey,
              agentAccountId: ctx.agentAccountId,
            });
          }

          const payload = {
            ok: !isToolError(invoked.result),
            tool: pluginToolName,
            endpoint: invoked.endpoint,
            protocol: invoked.protocol,
            remoteTool: invoked.remoteToolName,
            availableRemoteTools: invoked.availableToolNames,
            result: invoked.result,
            wan26AutoSend,
          };
          return jsonResult(payload);
        } catch (error) {
          return jsonResult(
            buildMcpCallFailurePayload({
              error,
              toolId: params.toolId,
              toolName: pluginToolName,
              endpoint: executionToolConfig.endpoint,
            }),
          );
        }
      },
    };
  };
}

export function createAliyunMcpRegistrations(params: {
  pluginConfig: unknown;
  clawConfig?: OpenClawConfig;
  channelId?: string;
  logger?: LoggerLike;
}): AliyunMcpRegistrationResult {
  const resolved = resolveAliyunMcpConfig(params.pluginConfig, {
    clawConfig: params.clawConfig,
    channelId: params.channelId,
  });
  const warnings = buildAliyunMcpSearchWarnings({
    config: resolved,
    clawConfig: params.clawConfig,
  });

  const tools: AliyunMcpToolRegistration[] = [
    {
      name: ALIYUN_MCP_PLUGIN_TOOL_NAMES.webSearch,
      factory: createToolFactory({
        toolId: "webSearch",
        label: "Aliyun Web Search",
        description: WEB_SEARCH_DESCRIPTION,
        parameters: WebSearchSchema,
        pluginConfig: params.pluginConfig,
        clawConfig: params.clawConfig,
        logger: params.logger,
      }),
    },
    {
      name: ALIYUN_MCP_PLUGIN_TOOL_NAMES.codeInterpreter,
      factory: createToolFactory({
        toolId: "codeInterpreter",
        label: "Aliyun Code Interpreter",
        description: CODE_INTERPRETER_DESCRIPTION,
        parameters: GenericArgsSchema,
        pluginConfig: params.pluginConfig,
        clawConfig: params.clawConfig,
        logger: params.logger,
      }),
    },
    {
      name: ALIYUN_MCP_PLUGIN_TOOL_NAMES.webParser,
      factory: createToolFactory({
        toolId: "webParser",
        label: "Aliyun Web Parser",
        description: WEB_PARSER_DESCRIPTION,
        parameters: GenericArgsSchema,
        pluginConfig: params.pluginConfig,
        clawConfig: params.clawConfig,
        logger: params.logger,
      }),
    },
    {
      name: ALIYUN_MCP_PLUGIN_TOOL_NAMES.wan26Media,
      factory: createToolFactory({
        toolId: "wan26Media",
        label: "Aliyun Wan2.6 Media",
        description: WAN26_MEDIA_DESCRIPTION,
        parameters: Wan26Schema,
        pluginConfig: params.pluginConfig,
        clawConfig: params.clawConfig,
        logger: params.logger,
      }),
    },
  ];

  return {
    config: resolved,
    tools,
    warnings,
  };
}
