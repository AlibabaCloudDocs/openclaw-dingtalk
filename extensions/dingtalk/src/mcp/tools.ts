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
  };
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

function normalizeRemoteArgs(params: Record<string, unknown>): Record<string, unknown> {
  const nested = params.arguments;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return params;
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
  return {
    ok: false,
    error: "missing_dashscope_api_key",
    message: `Missing API key for ${ALIYUN_MCP_PLUGIN_TOOL_NAMES[toolId]}. Configure one of: ${describeAliyunMcpApiKeyHints(toolId)}.`,
  };
}

function createToolFactory(params: {
  toolId: AliyunMcpToolId;
  label: string;
  description: string;
  parameters: unknown;
  config: AliyunMcpConfig;
  logger?: LoggerLike;
}) {
  const pluginToolName = ALIYUN_MCP_PLUGIN_TOOL_NAMES[params.toolId];

  return (ctx: ToolContext) => ({
    name: pluginToolName,
    label: params.label,
    description: params.description,
    parameters: params.parameters,
    execute: async (_toolCallId: string, args: unknown) => {
      const apiKey = resolveAliyunMcpApiKey({
        toolId: params.toolId,
        config: params.config,
      });
      if (!apiKey) {
        return jsonResult(makeMissingApiKeyPayload(params.toolId));
      }

      const allArgs = (args ?? {}) as Record<string, unknown>;
      const remoteArgs =
        params.toolId === "webSearch" ? allArgs : normalizeRemoteArgs(allArgs);
      const toolConfig = params.config.tools[params.toolId];

      try {
        const invoked = await invokeAliyunMcpTool({
          toolId: params.toolId,
          endpoint: toolConfig.endpoint,
          apiKey,
          timeoutSeconds: params.config.timeoutSeconds,
          arguments: remoteArgs,
          logger: params.logger,
        });

        let wan26AutoSend;
        if (
          params.toolId === "wan26Media" &&
          params.config.tools.wan26Media.autoSendToDingtalk
        ) {
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
        return jsonResult({
          ok: false,
          error: "mcp_call_failed",
          tool: pluginToolName,
          endpoint: toolConfig.endpoint,
          message: String(error),
        });
      }
    },
  });
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

  const tools: AliyunMcpToolRegistration[] = [];
  if (resolved.tools.webSearch.enabled) {
    tools.push({
      name: ALIYUN_MCP_PLUGIN_TOOL_NAMES.webSearch,
      factory: createToolFactory({
        toolId: "webSearch",
        label: "Aliyun Web Search",
        description:
          "Search the web through Aliyun DashScope MCP WebSearch endpoint. Replaces default Brave web_search when core search is disabled.",
        parameters: WebSearchSchema,
        config: resolved,
        logger: params.logger,
      }),
    });
  }

  if (resolved.tools.codeInterpreter.enabled) {
    tools.push({
      name: ALIYUN_MCP_PLUGIN_TOOL_NAMES.codeInterpreter,
      factory: createToolFactory({
        toolId: "codeInterpreter",
        label: "Aliyun Code Interpreter",
        description:
          "Run remote code-interpreter tasks through Aliyun DashScope MCP. Pass parameters directly or via arguments object.",
        parameters: GenericArgsSchema,
        config: resolved,
        logger: params.logger,
      }),
    });
  }

  if (resolved.tools.webParser.enabled) {
    tools.push({
      name: ALIYUN_MCP_PLUGIN_TOOL_NAMES.webParser,
      factory: createToolFactory({
        toolId: "webParser",
        label: "Aliyun Web Parser",
        description:
          "Parse and extract web content through Aliyun DashScope MCP WebParser. Pass parameters directly or via arguments object.",
        parameters: GenericArgsSchema,
        config: resolved,
        logger: params.logger,
      }),
    });
  }

  if (resolved.tools.wan26Media.enabled) {
    tools.push({
      name: ALIYUN_MCP_PLUGIN_TOOL_NAMES.wan26Media,
      factory: createToolFactory({
        toolId: "wan26Media",
        label: "Aliyun Wan2.6 Media",
        description:
          "Generate image/video through Aliyun DashScope MCP Wan2.6. Supports optional auto-send back to current DingTalk session.",
        parameters: GenericArgsSchema,
        config: resolved,
        logger: params.logger,
      }),
    });
  }

  return {
    config: resolved,
    tools,
    warnings,
  };
}
