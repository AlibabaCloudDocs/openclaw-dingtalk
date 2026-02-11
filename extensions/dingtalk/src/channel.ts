/**
 * DingTalk Channel Plugin for Clawdbot.
 */

import type {
  ChannelPlugin,
  ChannelCapabilities,
  ChannelMeta,
  ChannelAccountSnapshot,
} from "openclaw/plugin-sdk";
type ClawdbotConfig = any;
import {
  type ResolvedDingTalkAccount,
  listDingTalkAccountIds,
  resolveDingTalkAccount,
  resolveDefaultDingTalkAccountId,
  isDingTalkAccountConfigured,
} from "./accounts.js";
import { DEFAULT_ACCOUNT_ID, DINGTALK_CHANNEL_ID, DINGTALK_NPM_PACKAGE } from "./config-schema.js";
import { chunkMarkdownText } from "./send/chunker.js";
import { monitorDingTalkProvider } from "./monitor.js";
import { probeDingTalk } from "./probe.js";
import { sendProactiveMessage, sendImageMessage, sendActionCardMessage, sendMediaByPath, parseTarget } from "./api/send-message.js";
import { isLocalPath, isImageUrl } from "./api/media-upload.js";
import { ALIYUN_MCP_DEFAULT_ENDPOINTS, ALIYUN_MCP_DEFAULT_TIMEOUT_SECONDS } from "./mcp/constants.js";
import { ensureCoreWebSearchDisabledForAliyun } from "./mcp/core-search-sync.js";
import { getOrCreateTokenManager } from "./runtime.js";
import type { StreamLogger } from "./stream/types.js";
import type { DingTalkChannelData } from "./types/channel-data.js";
import { createCardInstance, updateCardInstance, deliverCardInstance, createAndDeliverCardInstance } from "./api/card-instances.js";
import {
  buildCardDataFromText,
  ensureCardFinishedStatus,
  generateOutTrackId,
  normalizeOpenSpaceId,
  resolveOpenSpace,
  resolveTemplateId,
} from "./util/ai-card.js";

/**
 * Adapt clawdbot SubsystemLogger to StreamLogger interface.
 * Clawdbot uses (message, meta) order, our StreamLogger uses (obj, msg) order.
 */
function adaptLogger(log: { info?: (msg: string, meta?: unknown) => void; debug?: (msg: string, meta?: unknown) => void; warn?: (msg: string, meta?: unknown) => void; error?: (msg: string, meta?: unknown) => void } | undefined): StreamLogger | undefined {
  if (!log) return undefined;
  return {
    info: (obj, msg) => {
      const message = msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj));
      log.info?.(message, typeof obj === 'object' ? obj : undefined);
    },
    debug: (obj, msg) => {
      const message = msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj));
      log.debug?.(message, typeof obj === 'object' ? obj : undefined);
    },
    warn: (obj, msg) => {
      const message = msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj));
      log.warn?.(message, typeof obj === 'object' ? obj : undefined);
    },
    error: (obj, msg) => {
      const message = msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj));
      log.error?.(message, typeof obj === 'object' ? obj : undefined);
    },
  };
}

/**
 * Channel metadata.
 */
const meta: ChannelMeta = {
  id: DINGTALK_CHANNEL_ID,
  label: "DingTalk",
  selectionLabel: "钉钉 (DingTalk)",
  blurb: "Enterprise messaging platform by Alibaba",
  docsPath: "/docs/channels/dingtalk",
  order: 50,
  aliases: ["dingding", "钉钉", DINGTALK_NPM_PACKAGE],
  systemImage: "dingtalk",
};

/**
 * Channel capabilities.
 */
const capabilities: ChannelCapabilities = {
  chatTypes: ["direct", "group"],
  reactions: false,
  threads: false,
  media: true, // Supports image sending
  nativeCommands: false,
  blockStreaming: true, // Use block-based streaming for DingTalk
};

const BAILIAN_MCP_MARKET_URL =
  "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/mcp-market";
const BAILIAN_MCP_DETAIL_URLS = {
  webSearch:
    "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/mcp-market/detail/WebSearch",
  codeInterpreter:
    "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/mcp-market/detail/code_interpreter_mcp",
  webParser:
    "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/mcp-market/detail/WebParser",
  wan26Media:
    "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/mcp-market/detail/Wan26Media",
} as const;

/**
 * DingTalk channel plugin.
 */
export const dingtalkPlugin: ChannelPlugin<ResolvedDingTalkAccount> = {
  id: DINGTALK_CHANNEL_ID,
  meta,
  capabilities,
  reload: { configPrefixes: [`channels.${DINGTALK_CHANNEL_ID}`] },

  // Config schema for Control UI
  configSchema: {
    schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: true },
        credentials: {
          type: "object",
          properties: {
            name: { type: "string" },
            clientId: { type: "string" },
            clientSecret: { type: "string" },
            clientSecretFile: { type: "string" },
            selfUserId: { type: "string" },
          },
        },
        conversation: {
          type: "object",
          properties: {
            allowFrom: { type: "array", items: { type: "string" } },
            requireMention: { type: "boolean", default: true },
            requirePrefix: { type: "string" },
            mentionBypassUsers: { type: "array", items: { type: "string" } },
            isolateContextPerUserInGroup: { type: "boolean", default: false },
            rateLimit: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
                windowSeconds: { type: "number", minimum: 1, default: 60 },
                maxRequests: { type: "number", minimum: 0, default: 8 },
                burst: { type: "number", minimum: 0, default: 3 },
                bypassUsers: { type: "array", items: { type: "string" }, default: [] },
                replyOnLimit: { type: "boolean", default: true },
                limitMessage: { type: "string", default: "请求太频繁，请稍后再试。" },
              },
            },
          },
        },
        reply: {
          type: "object",
          properties: {
            replyMode: { type: "string", enum: ["text", "markdown"], default: "text" },
            maxChars: { type: "number", default: 1800 },
            tableMode: { type: "string", enum: ["off", "code"], default: "code" },
            responsePrefix: { type: "string" },
            showToolStatus: { type: "boolean", default: false },
            showToolResult: { type: "boolean", default: false },
            thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high"], default: "off" },
            coalesce: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
                minChars: { type: "number", minimum: 200, default: 800 },
                maxChars: { type: "number", minimum: 800, default: 1200 },
                idleMs: { type: "number", minimum: 0, default: 1000 },
              },
            },
          },
        },
        streaming: {
          type: "object",
          properties: {
            blockStreaming: { type: "boolean", default: true },
            streamBlockTextToSession: { type: "boolean", default: true },
          },
        },
        connection: {
          type: "object",
          properties: {
            apiBase: { type: "string", default: "https://api.dingtalk.com" },
            openPath: { type: "string", default: "/v1.0/gateway/connections/open" },
            subscriptionsJson: { type: "string" },
          },
        },
        aiCard: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: false },
            templateId: { type: "string" },
            autoReply: { type: "boolean", default: true },
            textParamKey: { type: "string" },
            defaultCardData: { type: "object" },
            callbackType: { type: "string", enum: ["STREAM", "HTTP"], default: "STREAM" },
            updateThrottleMs: { type: "number", default: 800 },
            fallbackReplyMode: { type: "string", enum: ["text", "markdown"] },
            openSpace: { type: "object" },
          },
        },
        aliyunMcp: {
          type: "object",
          additionalProperties: false,
          properties: {
            apiKey: { type: "string" },
            timeoutSeconds: {
              type: "number",
              minimum: 1,
              default: ALIYUN_MCP_DEFAULT_TIMEOUT_SECONDS,
            },
            tools: {
              type: "object",
              additionalProperties: false,
              properties: {
                webSearch: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean", default: false },
                    endpoint: { type: "string", default: ALIYUN_MCP_DEFAULT_ENDPOINTS.webSearch },
                  },
                },
                codeInterpreter: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean", default: false },
                    endpoint: {
                      type: "string",
                      default: ALIYUN_MCP_DEFAULT_ENDPOINTS.codeInterpreter,
                    },
                  },
                },
                webParser: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean", default: false },
                    endpoint: { type: "string", default: ALIYUN_MCP_DEFAULT_ENDPOINTS.webParser },
                  },
                },
                wan26Media: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean", default: false },
                    endpoint: { type: "string", default: ALIYUN_MCP_DEFAULT_ENDPOINTS.wan26Media },
                    autoSendToDingtalk: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    uiHints: {
      enabled: { label: "启用钉钉渠道", help: "总开关。关闭后该账号不接收消息也不发送回复。", order: 10 },
      credentials: {
        label: "1. 接入凭据",
        help: "先完成机器人凭据配置，再继续配置消息行为。",
        order: 20,
      },
      "credentials.name": { label: "账号显示名称", help: "用于多账号场景下的识别名称（可选）。", order: 10 },
      "credentials.clientId": {
        label: "Client ID (AppKey)",
        help: "钉钉应用的 Client ID。可在开发者后台查看。",
        placeholder: "dingo...",
        order: 20,
      },
      "credentials.clientSecret": {
        label: "Client Secret (AppSecret)",
        help: "钉钉应用密钥。建议优先使用文件或环境变量管理。",
        sensitive: true,
        order: 30,
      },
      "credentials.clientSecretFile": {
        label: "Client Secret 文件路径",
        help: "从本地文件读取 Client Secret，适合生产环境避免明文写入配置。",
        advanced: true,
        order: 40,
      },
      "credentials.selfUserId": {
        label: "机器人用户 ID",
        help: "用于过滤机器人自身消息，避免自触发循环。",
        advanced: true,
        order: 50,
      },
      conversation: {
        label: "2. 会话触发与权限",
        help: "控制哪些消息会触发机器人，以及群聊上下文隔离策略。",
        order: 30,
      },
      "conversation.allowFrom": {
        label: "允许发送者列表",
        help: "仅允许列表内用户触发（留空表示允许所有用户）。",
        advanced: true,
        order: 10,
      },
      "conversation.requireMention": {
        label: "群聊要求 @机器人",
        help: "开启后，群聊里需要 @ 机器人才会响应。",
        advanced: true,
        order: 20,
      },
      "conversation.requirePrefix": {
        label: "群聊触发前缀",
        help: "设置后仅响应以此前缀开头的消息（仅群聊生效）。",
        advanced: true,
        order: 30,
      },
      "conversation.mentionBypassUsers": {
        label: "@提及豁免用户",
        help: "这些用户在群聊中可不 @ 机器人直接触发。",
        advanced: true,
        order: 40,
      },
      "conversation.isolateContextPerUserInGroup": {
        label: "群聊按用户隔离上下文",
        help: "开启后同一群内每个用户拥有独立会话上下文。",
        advanced: true,
        order: 50,
      },
      "conversation.rateLimit": {
        label: "消息限流（防刷屏）",
        help: "按发送者做滚动窗口限流，避免群聊刷屏或误触导致的高频调用。",
        advanced: true,
        order: 60,
      },
      "conversation.rateLimit.enabled": {
        label: "启用限流",
        help: "开启后，超过阈值会直接拒绝并可选返回提示，不会触发模型/工具调用。",
        advanced: true,
        order: 61,
      },
      "conversation.rateLimit.windowSeconds": {
        label: "统计窗口（秒）",
        help: "在最近 windowSeconds 秒内统计触发次数。",
        advanced: true,
        order: 62,
      },
      "conversation.rateLimit.maxRequests": {
        label: "窗口内最大请求数",
        help: "基础阈值。实际允许次数为 maxRequests + burst。",
        advanced: true,
        order: 63,
      },
      "conversation.rateLimit.burst": {
        label: "突发余量（burst）",
        help: "允许在窗口内额外通过的请求数（与 maxRequests 相加）。",
        advanced: true,
        order: 64,
      },
      "conversation.rateLimit.bypassUsers": {
        label: "限流豁免用户",
        help: "这些用户不受限流影响（按 senderId 匹配）。",
        advanced: true,
        order: 65,
      },
      "conversation.rateLimit.replyOnLimit": {
        label: "触发限流时回复提示",
        help: "关闭后限流只会静默丢弃，不会发送提示。",
        advanced: true,
        order: 66,
      },
      "conversation.rateLimit.limitMessage": {
        label: "限流提示文案",
        help: "触发限流时返回给用户的简短提示。",
        advanced: true,
        order: 67,
      },
      aliyunMcp: {
        order: 35,
        label: "3. 阿里云百炼 MCP",
        help:
          `四个内置 MCP 默认关闭。启用前请先在百炼控制台完成开通。` +
          `注意：部分 MCP 服务可能按调用计费，账单会计入 API Key 所属账号。` +
          `MCP 广场：${BAILIAN_MCP_MARKET_URL}`,
      },
      "aliyunMcp.apiKey": {
        label: "百炼 MCP API Key",
        help:
          "用于阿里云百炼 MCP 工具的鉴权（不是模型 provider 的 apiKey）。" +
          "保存后会写入 channels.clawdbot-dingtalk.aliyunMcp.apiKey。" +
          "如果 Control UI 保存失败，可把 key 写入 ~/.openclaw/secrets/clawdbot-dingtalk/aliyun-mcp-api-key（0600 权限），或用 OPENCLAW_DINGTALK_MCP_API_KEY_FILE 指定文件路径。" +
          "建议优先使用 DASHSCOPE_MCP_<TOOL>_API_KEY 或 DASHSCOPE_API_KEY 环境变量。注意：部分 MCP 可能收费，费用会计入该 API Key 所属账号。",
        sensitive: true,
        advanced: true,
        order: 10,
      },
      "aliyunMcp.timeoutSeconds": { label: "MCP 超时（秒）", advanced: true, order: 20 },
      "aliyunMcp.tools": { label: "工具开关", advanced: true, order: 30 },
      "aliyunMcp.tools.webSearch.enabled": {
        label: "启用联网搜索（WebSearch）",
        help: `开通提醒：先在百炼控制台开通“联网搜索”MCP。详情：${BAILIAN_MCP_DETAIL_URLS.webSearch}`,
        order: 10,
      },
      "aliyunMcp.tools.webSearch.endpoint": {
        label: "联网搜索服务地址",
        help: "默认使用百炼官方 WebSearch MCP 地址。",
        advanced: true,
        order: 20,
      },
      "aliyunMcp.tools.codeInterpreter.enabled": {
        label: "启用代码解释器（code_interpreter_mcp）",
        help: `开通提醒：先在百炼控制台开通“代码解释器”MCP。详情：${BAILIAN_MCP_DETAIL_URLS.codeInterpreter}`,
        order: 30,
      },
      "aliyunMcp.tools.codeInterpreter.endpoint": {
        label: "代码解释器服务地址",
        help: "默认使用百炼官方 code_interpreter_mcp 地址。",
        advanced: true,
        order: 40,
      },
      "aliyunMcp.tools.webParser.enabled": {
        label: "启用网页解析（WebParser）",
        help: `开通提醒：先在百炼控制台开通“网页解析”MCP。详情：${BAILIAN_MCP_DETAIL_URLS.webParser}`,
        order: 50,
      },
      "aliyunMcp.tools.webParser.endpoint": {
        label: "网页解析服务地址",
        help: "默认使用百炼官方 WebParser MCP 地址。",
        advanced: true,
        order: 60,
      },
      "aliyunMcp.tools.wan26Media.enabled": {
        label: "启用通义万相2.6（Wan26Media）",
        help: `开通提醒：先在百炼控制台开通“通义万相2.6-图像视频生成”MCP。详情：${BAILIAN_MCP_DETAIL_URLS.wan26Media}`,
        order: 70,
      },
      "aliyunMcp.tools.wan26Media.endpoint": {
        label: "通义万相2.6服务地址",
        help: "默认使用百炼官方 Wan26Media MCP 地址。",
        advanced: true,
        order: 80,
      },
      "aliyunMcp.tools.wan26Media.autoSendToDingtalk": {
        label: "万相结果自动回传钉钉会话",
        help: "开启后，媒体生成完成会自动发送回当前钉钉会话。",
        order: 90,
      },
      reply: {
        label: "4. 回复策略与展示",
        help: "设置回复格式、文本长度、思考强度和工具执行提示。",
        order: 40,
      },
      "reply.replyMode": { label: "回复模式", help: "text 为纯文本，markdown 为富文本。", order: 10 },
      "reply.maxChars": { label: "单条最大字符数", help: "超过后会自动拆分为多条消息发送。", order: 20 },
      "reply.tableMode": {
        label: "表格处理模式",
        help: "off 保留原样，code 将 Markdown 表格转代码块提高兼容性。",
        advanced: true,
        order: 30,
      },
      "reply.responsePrefix": {
        label: "回复前缀",
        help: "追加到每条回复开头，支持 {model}/{provider}/{identity} 变量。",
        advanced: true,
        order: 40,
      },
      "reply.showToolStatus": {
        label: "显示工具执行状态",
        help: "执行工具时发送“正在执行”提示，便于用户感知过程。",
        advanced: true,
        order: 50,
      },
      "reply.showToolResult": {
        label: "显示工具执行结果",
        help: "工具执行完成后发送“执行完成”结果提示。",
        advanced: true,
        order: 60,
      },
      "reply.thinking": {
        label: "思考强度",
        help: "控制模型推理强度：off/minimal/low/medium/high。",
        advanced: true,
        order: 70,
      },
      "reply.coalesce": {
        label: "流式合并发送",
        help: "将短增量合并后再发送，降低刷屏并保持可读性。",
        advanced: true,
        order: 80,
      },
      "reply.coalesce.enabled": {
        label: "启用合并发送",
        help: "开启后按阈值合并流式文本再下发到钉钉。",
        advanced: true,
        order: 10,
      },
      "reply.coalesce.minChars": {
        label: "最小合并字符数",
        help: "累计达到该字符数后可触发发送（建议小于 maxChars）。",
        advanced: true,
        order: 20,
      },
      "reply.coalesce.maxChars": {
        label: "最大合并字符数",
        help: "累计超过该值会立即发送，避免单条过长。",
        advanced: true,
        order: 30,
      },
      "reply.coalesce.idleMs": {
        label: "空闲触发时间 (ms)",
        help: "在新增内容暂时停顿超过该时长时立即发送。",
        advanced: true,
        order: 40,
      },
      streaming: {
        label: "5. 流式输出",
        help: "控制增量输出（block）与最终回复（final）的生成与发送策略。",
        order: 50,
      },
      "streaming.blockStreaming": {
        label: "增量流式输出 (block)",
        help: "开启后会产生并推送分段输出（更快看到内容）；关闭后尽量只输出最终回复（final）。",
        advanced: true,
        order: 10,
      },
      "streaming.streamBlockTextToSession": {
        label: "将增量输出直接发到钉钉",
        help: "开启后每段 block 都会立即发送到会话（可能多条消息）；关闭则先缓存 block，最后只发一条完整回复。",
        advanced: true,
        order: 20,
      },
      connection: {
        label: "6. 连接与网关",
        help: "高级连接参数。除私有化或调试场景外建议保持默认。",
        order: 60,
      },
      "connection.apiBase": {
        label: "API 基础地址",
        help: "默认 https://api.dingtalk.com。",
        advanced: true,
        order: 10,
      },
      "connection.openPath": {
        label: "Stream Open Path",
        help: "默认 /v1.0/gateway/connections/open。",
        advanced: true,
        order: 20,
      },
      "connection.subscriptionsJson": {
        label: "订阅配置 JSON",
        help: "自定义 stream 订阅结构（高级调试用途）。",
        advanced: true,
        order: 30,
      },
      aiCard: {
        label: "7. AI 卡片",
        help: "配置钉钉 AI 卡片模板、回调与流式更新策略。",
        order: 70,
      },
      "aiCard.enabled": { label: "启用 AI 卡片", help: "开启后可使用互动卡片回复。", advanced: true, order: 10 },
      "aiCard.templateId": { label: "默认模板 ID", help: "未显式指定时使用该模板。", advanced: true, order: 20 },
      "aiCard.autoReply": {
        label: "自动卡片回复",
        help: "未指定 card 参数时自动将文本回复映射为卡片。",
        advanced: true,
        order: 30,
      },
      "aiCard.textParamKey": { label: "文本变量 Key", help: "自动回复时写入文本变量的字段名。", advanced: true, order: 40 },
      "aiCard.defaultCardData": { label: "默认卡片数据", help: "自动回复时附加的默认模板变量。", advanced: true, order: 50 },
      "aiCard.callbackType": { label: "回调类型", help: "卡片回调模式，默认 STREAM。", advanced: true, order: 60 },
      "aiCard.updateThrottleMs": { label: "更新节流 (ms)", help: "限制流式更新频率，降低回调压力。", advanced: true, order: 70 },
      "aiCard.fallbackReplyMode": { label: "失败回退模式", help: "卡片发送失败时回退到 text 或 markdown。", advanced: true, order: 80 },
      "aiCard.openSpace": { label: "默认 openSpace", help: "卡片投放 openSpace 结构（高级）。", advanced: true, order: 90 },
    } as Record<string, any>,
  },

  config: {
    listAccountIds: (cfg) => listDingTalkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveDingTalkAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultDingTalkAccountId(cfg),

    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const dingtalk = (cfg.channels as Record<string, unknown>)?.[DINGTALK_CHANNEL_ID] as
        | Record<string, unknown>
        | undefined;
      if (!dingtalk) return cfg;

      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            [DINGTALK_CHANNEL_ID]: { ...dingtalk, enabled },
          },
        };
      }

      const accounts = (dingtalk.accounts ?? {}) as Record<string, unknown>;
      const account = (accounts[accountId] ?? {}) as Record<string, unknown>;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          [DINGTALK_CHANNEL_ID]: {
            ...dingtalk,
            accounts: {
              ...accounts,
              [accountId]: { ...account, enabled },
            },
          },
        },
      };
    },

    deleteAccount: ({ cfg, accountId }) => {
      const dingtalk = (cfg.channels as Record<string, unknown>)?.[DINGTALK_CHANNEL_ID] as
        | Record<string, unknown>
        | undefined;
      if (!dingtalk) return cfg;

      if (accountId === DEFAULT_ACCOUNT_ID) {
        // Clear base-level credentials (both grouped and legacy paths)
        const {
          clientId: _legacyClientId,
          clientSecret: _legacyClientSecret,
          clientSecretFile: _legacyClientSecretFile,
          ...rest
        } = dingtalk;
        const credentials = (dingtalk.credentials ?? {}) as Record<string, unknown>;
        const {
          clientId: _groupClientId,
          clientSecret: _groupClientSecret,
          clientSecretFile: _groupClientSecretFile,
          ...restCredentials
        } = credentials;
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            [DINGTALK_CHANNEL_ID]: {
              ...rest,
              credentials: Object.keys(restCredentials).length > 0 ? restCredentials : undefined,
            },
          },
        };
      }

      const accounts = { ...((dingtalk.accounts ?? {}) as Record<string, unknown>) };
      delete accounts[accountId];
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          [DINGTALK_CHANNEL_ID]: {
            ...dingtalk,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },

    isConfigured: (account) => isDingTalkAccountConfigured(account),

    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: isDingTalkAccountConfigured(account),
      credentialSource: account.credentialSource,
    }),

    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveDingTalkAccount({ cfg, accountId });
      return account.allowFrom;
    },

    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^dingtalk:/i, "")),
  },

  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 1800,

    sendText: async ({ to, text, cfg, accountId }) => {
      // Resolve account configuration
      const account = resolveDingTalkAccount({ cfg, accountId });

      // Check if credentials are configured
      if (!isDingTalkAccountConfigured(account)) {
        return {
          channel: "dingtalk",
          ok: false,
          error: new Error(
            `DingTalk credentials not configured for account "${account.accountId}". ` +
            `Set channels.dingtalk.clientId and channels.dingtalk.clientSecret.`
          ),
          messageId: "",
        };
      }

      // Get or create token manager for this account
      const tokenManager = getOrCreateTokenManager(account);

      // Send proactive message using DingTalk API
      const result = await sendProactiveMessage({
        account,
        to,
        text,
        replyMode: account.replyMode,
        tokenManager,
      });

      return {
        channel: "dingtalk",
        ok: result.ok,
        messageId: result.processQueryKey || "",
        ...(result.error ? { error: result.error } : {}),
        ...(result.invalidUserIds?.length ? { meta: { invalidUserIds: result.invalidUserIds } } : {}),
      };
    },

    sendMedia: async ({ to, text, mediaUrl, cfg, accountId }) => {
      const account = resolveDingTalkAccount({ cfg, accountId });

      if (!isDingTalkAccountConfigured(account)) {
        return {
          channel: "dingtalk",
          ok: false,
          error: new Error(
            `DingTalk credentials not configured for account "${account.accountId}". ` +
            `Set channels.dingtalk.clientId and channels.dingtalk.clientSecret.`
          ),
          messageId: "",
        };
      }

      const tokenManager = getOrCreateTokenManager(account);

      // Check if mediaUrl is a local path or remote URL that needs special handling
      if (isLocalPath(mediaUrl)) {
        // Use sendMediaByPath for local files (handles upload automatically)
        const result = await sendMediaByPath({
          account,
          to,
          mediaUrl,
          text,
          tokenManager,
        });

        return {
          channel: "dingtalk",
          ok: result.ok,
          messageId: result.processQueryKey || "",
          ...(result.error ? { error: result.error } : {}),
        };
      }

      // Remote URL handling
      const isImage = isImageUrl(mediaUrl);

      if (isImage) {
        // Send as native image message
        const result = await sendImageMessage({
          account,
          to,
          picUrl: mediaUrl,
          text,
          tokenManager,
        });

        return {
          channel: "dingtalk",
          ok: result.ok,
          messageId: result.processQueryKey || "",
          ...(result.error ? { error: result.error } : {}),
        };
      }

      // For non-image remote files, use sendMediaByPath (handles download + upload)
      const result = await sendMediaByPath({
        account,
        to,
        mediaUrl,
        text,
        tokenManager,
      });

      return {
        channel: "dingtalk",
        ok: result.ok,
        messageId: result.processQueryKey || "",
        ...(result.error ? { error: result.error } : {}),
      };
    },

    sendPayload: async ({ to, payload, cfg, accountId }) => {
      const account = resolveDingTalkAccount({ cfg, accountId });

      if (!isDingTalkAccountConfigured(account)) {
        return {
          channel: "dingtalk",
          ok: false,
          error: new Error(
            `DingTalk credentials not configured for account "${account.accountId}". ` +
            `Set channels.dingtalk.clientId and channels.dingtalk.clientSecret.`
          ),
          messageId: "",
        };
      }

      const tokenManager = getOrCreateTokenManager(account);
      const channelData = payload.channelData?.dingtalk as DingTalkChannelData | undefined;

      // Handle AI Card
      if (channelData?.card || (account.aiCard.enabled && account.aiCard.autoReply && account.aiCard.templateId && payload.text?.trim())) {
        const card = channelData?.card ?? {
          cardData: buildCardDataFromText({
            account,
            text: payload.text?.trim() ?? "",
          }),
        };

        const fallbackToText = async (reason: string) => {
          if (!payload.text) {
            return {
              channel: "dingtalk",
              ok: false,
              error: new Error(reason),
              messageId: "",
            };
          }

          const fallbackMode = account.aiCard.fallbackReplyMode ?? account.replyMode;
          const fallback = await sendProactiveMessage({
            account,
            to,
            text: payload.text,
            replyMode: fallbackMode,
            tokenManager,
          });

          return {
            channel: "dingtalk",
            ok: fallback.ok,
            messageId: fallback.processQueryKey || "",
            ...(fallback.error ? { error: fallback.error } : {}),
          };
        };

        if (!account.aiCard.enabled) {
          return fallbackToText("AI Card is disabled for this account.");
        }

        const templateId = resolveTemplateId(account, card);
        if (!templateId) {
          return fallbackToText("Missing AI card templateId.");
        }

        let { openSpace, openSpaceId } = resolveOpenSpace({ account, card });
        const target = parseTarget(to);
        if (!openSpaceId && target.type === "group") {
          openSpaceId = `dtv1.card//IM_GROUP.${target.id}`;
        }
        if (!openSpaceId && target.type === "user") {
          openSpaceId = `dtv1.card//IM_ROBOT.${target.id}`;
        }
        openSpaceId = normalizeOpenSpaceId(openSpaceId);

        if (!openSpace && !openSpaceId) {
          return fallbackToText("Missing openSpace/openSpaceId for AI card delivery.");
        }

        const outTrackId = card.outTrackId ?? generateOutTrackId("card");
        const callbackType = card.callbackType ?? account.aiCard.callbackType;
        const effectiveCardData = card.stream === true
          ? card.cardData
          : ensureCardFinishedStatus(card.cardData);

        let result;
        if (card.mode === "update" || card.cardInstanceId) {
          result = await updateCardInstance({
            account,
            cardInstanceId: card.cardInstanceId,
            outTrackId,
            cardData: effectiveCardData,
            privateData: card.privateData,
            openSpace,
            openSpaceId,
            callbackType,
            tokenManager,
          });
        } else {
          const baseOpenSpace = openSpace ?? {};
          const openSpacePayload = target.type === "group"
            ? {
                ...baseOpenSpace,
                imGroupOpenSpaceModel: {
                  ...(baseOpenSpace as any).imGroupOpenSpaceModel,
                },
                imGroupOpenDeliverModel: {
                  robotCode: account.clientId,
                },
              }
            : {
                ...baseOpenSpace,
                imRobotOpenSpaceModel: {
                  ...(baseOpenSpace as any).imRobotOpenSpaceModel,
                },
                imRobotOpenDeliverModel: {
                  spaceType: "IM_ROBOT",
                  robotCode: account.clientId,
                },
              };

          result = await createAndDeliverCardInstance({
            account,
            templateId,
            outTrackId,
            cardData: effectiveCardData,
            privateData: card.privateData,
            openSpace: openSpacePayload,
            openSpaceId,
            callbackType,
            userId: target.type === "user" ? target.id : undefined,
            userIdType: target.type === "user" ? 1 : undefined,
            robotCode: account.clientId,
            tokenManager,
          });
        }

        if (result.ok) {
          return {
            channel: "dingtalk",
            ok: true,
            messageId: result.cardInstanceId ?? outTrackId,
          };
        }

        if (!card.cardInstanceId && (card.mode !== "update") && openSpaceId) {
          await deliverCardInstance({
            account,
            outTrackId,
            openSpaceId,
            userIdType: 1,
            imGroupOpenDeliverModel: target.type === "group"
              ? { robotCode: account.clientId }
              : undefined,
            imRobotOpenDeliverModel: target.type === "user"
              ? { spaceType: "IM_ROBOT", robotCode: account.clientId }
              : undefined,
            tokenManager,
          });
        }

        return fallbackToText(result.error?.message ?? "AI Card send failed");
      }

      // Handle ActionCard
      if (channelData?.actionCard) {
        const result = await sendActionCardMessage({
          account,
          to,
          actionCard: channelData.actionCard,
          tokenManager,
        });

        return {
          channel: "dingtalk",
          ok: result.ok,
          messageId: result.processQueryKey || "",
          ...(result.error ? { error: result.error } : {}),
        };
      }

      // Handle image
      if (channelData?.image?.picUrl) {
        const result = await sendImageMessage({
          account,
          to,
          picUrl: channelData.image.picUrl,
          text: payload.text,
          tokenManager,
        });

        return {
          channel: "dingtalk",
          ok: result.ok,
          messageId: result.processQueryKey || "",
          ...(result.error ? { error: result.error } : {}),
        };
      }

      // Fall back to text message
      if (payload.text) {
        const result = await sendProactiveMessage({
          account,
          to,
          text: payload.text,
          replyMode: account.replyMode,
          tokenManager,
        });

        return {
          channel: "dingtalk",
          ok: result.ok,
          messageId: result.processQueryKey || "",
          ...(result.error ? { error: result.error } : {}),
        };
      }

      return {
        channel: "dingtalk",
        ok: false,
        error: new Error("No content to send in payload"),
        messageId: "",
      };
    },
  },

  // Messaging adapter: target resolution for DingTalk user IDs
  messaging: {
    targetResolver: {
      hint: 'Use DingTalk senderStaffId (e.g., "manager9140") or full senderId.',
      // DingTalk user IDs: senderStaffId like "manager9140" or senderId like "$:LWCP_v1:$..."
      looksLikeId: (raw: string, _normalized: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return false;
        // Matches senderStaffId patterns: manager9140, user12345, etc.
        if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return true;
        // Matches full senderId patterns: $:LWCP_v1:$...
        if (trimmed.startsWith("$:")) return true;
        return false;
      },
    },
  },

  // Groups adapter: @mention detection for group chats
  groups: {
    resolveRequireMention: ({ cfg, accountId }) => {
      const account = resolveDingTalkAccount({ cfg, accountId });
      // Only enforce mention requirement if:
      // 1. requireMention is enabled
      // 2. requirePrefix is not set (prefix takes precedence)
      return account.requireMention && !account.requirePrefix;
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastStartAt: null,
      lastStopAt: null,
      lastConnectedAt: null,
      lastDisconnect: null,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },

    probeAccount: async ({ account, timeoutMs }) => {
      return probeDingTalk(account, timeoutMs);
    },

    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: isDingTalkAccountConfigured(account),
      credentialSource: account.credentialSource,
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastConnectedAt: runtime?.lastConnectedAt ?? null,
      lastDisconnect: runtime?.lastDisconnect ?? null,
      lastError: runtime?.lastError ?? null,
      mode: "stream",
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),

    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      credentialSource: snapshot.credentialSource ?? "none",
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      mode: snapshot.mode ?? "stream",
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastConnectedAt: snapshot.lastConnectedAt ?? null,
      lastDisconnect: snapshot.lastDisconnect ?? null,
      lastError: snapshot.lastError ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const { account, cfg, abortSignal, log } = ctx;

      if (!isDingTalkAccountConfigured(account)) {
        throw new Error(
          `DingTalk credentials not configured for account "${account.accountId}". ` +
          `Set channels.dingtalk.clientId and channels.dingtalk.clientSecret.`
        );
      }

      log?.info?.(`[${account.accountId}] starting DingTalk stream provider`);

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        connected: false,
        lastStartAt: Date.now(),
        lastStopAt: null,
        lastError: null,
      });

      void ensureCoreWebSearchDisabledForAliyun({
        pluginConfig: {},
        clawConfig: cfg,
        logger: {
          info: (message) => log?.info?.(message),
          warn: (message) => log?.warn?.(message),
          error: (message) => log?.error?.(message),
        },
        reason: "channel_start",
      });

      const handle = await monitorDingTalkProvider({
        account,
        config: cfg,
        abortSignal,
        log: adaptLogger(log),
        statusSink: (patch) => ctx.setStatus({ accountId: account.accountId, ...patch }),
      });

      const waitForAbort = () =>
        abortSignal.aborted
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              abortSignal.addEventListener("abort", () => resolve(), { once: true });
            });

      await waitForAbort();
      log?.info?.(`[${account.accountId}] abort received; stopping DingTalk stream provider`);
      try {
        handle.stop();
      } catch (err) {
        log?.warn?.(
          `[${account.accountId}] stop() failed: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    },
  },
};
