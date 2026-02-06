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
        clientId: { type: "string" },
        clientSecret: { type: "string" },
        clientSecretFile: { type: "string" },
        replyMode: { type: "string", enum: ["text", "markdown"], default: "text" },
        maxChars: { type: "number", default: 1800 },
        tableMode: { type: "string", enum: ["off", "code"], default: "code" },
        responsePrefix: { type: "string" },
        requirePrefix: { type: "string" },
        requireMention: { type: "boolean", default: true },
        isolateContextPerUserInGroup: { type: "boolean", default: false },
        mentionBypassUsers: { type: "array", items: { type: "string" } },
        allowFrom: { type: "array", items: { type: "string" } },
        selfUserId: { type: "string" },
        blockStreaming: { type: "boolean", default: true },
        apiBase: { type: "string" },
        openPath: { type: "string" },
        subscriptionsJson: { type: "string" },
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
      enabled: { label: "启用", help: "是否启用钉钉渠道" },
      clientId: { label: "Client ID", help: "钉钉机器人的 Client ID（AppKey）", placeholder: "dingo..." },
      clientSecret: { label: "Client Secret", help: "钉钉机器人的 Client Secret（AppSecret）", sensitive: true },
      clientSecretFile: { label: "Client Secret 文件", help: "包含 Client Secret 的文件路径（替代直接配置）", advanced: true },
      replyMode: { label: "回复模式", help: "消息格式：text（纯文本）或 markdown" },
      maxChars: { label: "最大字符数", help: "单条消息最大字符数（超出将分段发送）" },
      tableMode: { label: "表格模式", help: "Markdown 表格处理方式：off（保留）、code（转为代码块）", advanced: true },
      responsePrefix: { label: "回复前缀", help: "添加到回复开头的文本（支持 {model}/{provider}/{identity} 变量）", advanced: true },
      requirePrefix: { label: "触发前缀", help: "群聊中需要以此前缀开头才会响应", advanced: true },
      requireMention: { label: "需要@提及", help: "群聊中需要@机器人才会响应（默认启用）", advanced: true },
      isolateContextPerUserInGroup: {
        label: "群聊上下文隔离",
        help: "开启后，同一个群聊中不同用户与机器人对话将使用不同上下文（互不影响）",
        advanced: true,
      },
      mentionBypassUsers: { label: "@提及豁免用户", help: "无需@机器人即可触发的用户 ID 列表", advanced: true },
      allowFrom: { label: "允许发送者", help: "允许发送消息的用户 ID 列表（空表示允许所有）", advanced: true },
      selfUserId: { label: "机器人用户 ID", help: "机器人自身的用户 ID，用于过滤自己的消息", advanced: true },
      blockStreaming: { label: "块流式回复", help: "启用后会发送 block 增量；关闭后只发送 final", advanced: true },
      apiBase: { label: "API 基础 URL", help: "钉钉 API 基础地址（默认：https://api.dingtalk.com）", advanced: true },
      openPath: { label: "Open Path", help: "Stream 连接路径（默认：/v1.0/gateway/connections/open）", advanced: true },
      subscriptionsJson: { label: "订阅配置 JSON", help: "自定义订阅配置 JSON（高级用法）", advanced: true },
      "aiCard.enabled": { label: "启用 AI 卡片", help: "是否启用高级互动卡片能力", advanced: true },
      "aiCard.templateId": { label: "默认模板 ID", help: "AI 卡片默认模板 ID", advanced: true },
      "aiCard.autoReply": { label: "自动卡片回复", help: "未显式指定 card 时自动用 AI 卡片回复", advanced: true },
      "aiCard.textParamKey": { label: "文本变量 Key", help: "自动回复时文本映射的变量名", advanced: true },
      "aiCard.defaultCardData": { label: "默认卡片数据", help: "自动回复时附加的默认变量", advanced: true },
      "aiCard.callbackType": { label: "回调类型", help: "卡片回调类型（默认 STREAM）", advanced: true },
      "aiCard.updateThrottleMs": { label: "更新节流 (ms)", help: "流式更新节流间隔", advanced: true },
      "aiCard.fallbackReplyMode": { label: "失败回退模式", help: "卡片发送失败时的文本模式", advanced: true },
      "aiCard.openSpace": { label: "默认 openSpace", help: "卡片投放 openSpace 结构（高级）", advanced: true },
      aliyunMcp: {
        label: "阿里云百炼 MCP",
        help: `四个内置 MCP 默认关闭。启用前请先在百炼控制台开通。MCP 广场：${BAILIAN_MCP_MARKET_URL}`,
      },
      "aliyunMcp.apiKey": {
        label: "DASHSCOPE API Key",
        help: "可选兜底鉴权；建议优先使用环境变量 DASHSCOPE_MCP_<TOOL>_API_KEY。",
        sensitive: true,
        advanced: true,
      },
      "aliyunMcp.timeoutSeconds": { label: "MCP 超时（秒）", advanced: true },
      "aliyunMcp.tools.webSearch.enabled": {
        label: "启用联网搜索（WebSearch）",
        help: `开通提醒：先在百炼控制台开通“联网搜索”MCP。详情：${BAILIAN_MCP_DETAIL_URLS.webSearch}`,
      },
      "aliyunMcp.tools.webSearch.endpoint": {
        label: "联网搜索服务地址",
        help: "默认使用百炼官方 WebSearch MCP 地址。",
        advanced: true,
      },
      "aliyunMcp.tools.codeInterpreter.enabled": {
        label: "启用代码解释器（code_interpreter_mcp）",
        help: `开通提醒：先在百炼控制台开通“代码解释器”MCP。详情：${BAILIAN_MCP_DETAIL_URLS.codeInterpreter}`,
      },
      "aliyunMcp.tools.codeInterpreter.endpoint": {
        label: "代码解释器服务地址",
        help: "默认使用百炼官方 code_interpreter_mcp 地址。",
        advanced: true,
      },
      "aliyunMcp.tools.webParser.enabled": {
        label: "启用网页解析（WebParser）",
        help: `开通提醒：先在百炼控制台开通“网页解析”MCP。详情：${BAILIAN_MCP_DETAIL_URLS.webParser}`,
      },
      "aliyunMcp.tools.webParser.endpoint": {
        label: "网页解析服务地址",
        help: "默认使用百炼官方 WebParser MCP 地址。",
        advanced: true,
      },
      "aliyunMcp.tools.wan26Media.enabled": {
        label: "启用通义万相2.6（Wan26Media）",
        help: `开通提醒：先在百炼控制台开通“通义万相2.6-图像视频生成”MCP。详情：${BAILIAN_MCP_DETAIL_URLS.wan26Media}`,
      },
      "aliyunMcp.tools.wan26Media.endpoint": {
        label: "通义万相2.6服务地址",
        help: "默认使用百炼官方 Wan26Media MCP 地址。",
        advanced: true,
      },
      "aliyunMcp.tools.wan26Media.autoSendToDingtalk": {
        label: "万相结果自动回传钉钉会话",
      },
    },
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
        // Clear base-level credentials
        const { clientId, clientSecret, clientSecretFile, ...rest } = dingtalk;
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            [DINGTALK_CHANNEL_ID]: rest,
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
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
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
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      mode: "stream",
    }),

    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      credentialSource: snapshot.credentialSource ?? "none",
      running: snapshot.running ?? false,
      mode: snapshot.mode ?? "stream",
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
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

      return monitorDingTalkProvider({
        account,
        config: cfg,
        abortSignal,
        log: adaptLogger(log),
      });
    },
  },
};
