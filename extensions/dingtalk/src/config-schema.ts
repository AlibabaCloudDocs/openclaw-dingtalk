import { z } from "zod";

/**
 * Coalesce configuration for batching small messages before sending.
 */
export const CoalesceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minChars: z.number().min(200).default(800),
  maxChars: z.number().min(800).default(1200),
  idleMs: z.number().min(0).default(1000),
});

/**
 * AI Card configuration.
 */
export const AICardConfigSchema = z.object({
  /** Enable/disable AI card sending */
  enabled: z.boolean().default(false),
  /** Default template ID */
  templateId: z.string().optional(),
  /** Auto-generate card replies from text */
  autoReply: z.boolean().default(true),
  /** Text parameter key used for auto replies */
  textParamKey: z.string().optional(),
  /** Default card data for auto replies */
  defaultCardData: z.record(z.unknown()).optional(),
  /** Callback type for card instance */
  callbackType: z.enum(["STREAM", "HTTP"]).default("STREAM"),
  /** Throttle interval for streaming updates */
  updateThrottleMs: z.number().min(0).default(800),
  /** Fallback reply mode when card sending fails */
  fallbackReplyMode: z.enum(["text", "markdown"]).optional(),
  /** Default openSpace payload (pass-through) */
  openSpace: z.record(z.unknown()).optional(),
});

/**
 * Shared thinking level enum.
 */
const ThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high"]);

/**
 * Grouped credentials settings for Control UI.
 */
export const CredentialsConfigSchema = z.object({
  /** Display name for this account */
  name: z.string().optional(),
  /** DingTalk app client ID (required) */
  clientId: z.string().optional(),
  /** DingTalk app client secret (required) */
  clientSecret: z.string().optional(),
  /** Path to file containing client secret */
  clientSecretFile: z.string().optional(),
  /** Bot's own user ID to skip self-messages */
  selfUserId: z.string().optional(),
});

/**
 * Grouped conversation filter settings for Control UI.
 */
export const ConversationConfigSchema = z.object({
  /** Allowlist of sender IDs (empty = allow all) */
  allowFrom: z.array(z.string()).default([]),
  /** Require messages to start with this prefix (for group filtering) */
  requirePrefix: z.string().optional(),
  /** Require @机器人 in group chats (default: true) */
  requireMention: z.boolean().default(true),
  /** Users who can bypass @mention requirement */
  mentionBypassUsers: z.array(z.string()).default([]),
  /** Isolate context per user in group chats (default: false) */
  isolateContextPerUserInGroup: z.boolean().default(false),
  /** Per-sender rolling-window rate limit */
  rateLimit: z
    .object({
      enabled: z.boolean().default(true),
      windowSeconds: z.number().min(1).default(60),
      maxRequests: z.number().min(0).default(8),
      burst: z.number().min(0).default(3),
      bypassUsers: z.array(z.string()).default([]),
      replyOnLimit: z.boolean().default(true),
      limitMessage: z
        .string()
        .default("请求太频繁，请稍后再试。"),
    })
    .default({
      enabled: true,
      windowSeconds: 60,
      maxRequests: 8,
      burst: 3,
      bypassUsers: [],
      replyOnLimit: true,
      limitMessage: "请求太频繁，请稍后再试。",
    }),
});

/**
 * Grouped reply formatting and model behavior settings for Control UI.
 */
export const ReplyConfigSchema = z.object({
  /** Reply mode: text or markdown */
  replyMode: z.enum(["text", "markdown"]).default("text"),
  /** Maximum characters per message chunk */
  maxChars: z.number().min(200).max(8000).default(1800),
  /** Table conversion mode for markdown */
  tableMode: z.enum(["code", "off"]).default("code"),
  /** Prefix to add to response messages (supports {model}, {provider} vars) */
  responsePrefix: z.string().optional(),
  /** Show tool status messages (🔧 正在执行...) */
  showToolStatus: z.boolean().default(false),
  /** Show tool result messages (✅ ... 完成) */
  showToolResult: z.boolean().default(false),
  /** Thinking mode for Clawdbot */
  thinking: ThinkingLevelSchema.default("off"),
  /** Message coalescing configuration */
  coalesce: CoalesceConfigSchema.optional(),
});

/**
 * Grouped streaming settings for Control UI.
 */
export const StreamingConfigSchema = z.object({
  /** Enable block streaming for incremental replies */
  blockStreaming: z.boolean().default(true),
  /** Stream block text directly to sessionWebhook (instead of waiting final) */
  streamBlockTextToSession: z.boolean().default(true),
});

/**
 * Grouped connection settings for Control UI.
 */
export const ConnectionConfigSchema = z.object({
  /** DingTalk API base URL */
  apiBase: z.string().default("https://api.dingtalk.com"),
  /** Stream open path */
  openPath: z.string().default("/v1.0/gateway/connections/open"),
  /** Custom subscriptions JSON for stream */
  subscriptionsJson: z.string().optional(),
});

/**
 * Account-level overrides for multi-account setup.
 */
const DingTalkAccountOverrideSchema = z.object({
  enabled: z.boolean().default(true),
  // New grouped paths (preferred)
  credentials: CredentialsConfigSchema.partial().optional(),
  conversation: ConversationConfigSchema.partial().optional(),
  reply: ReplyConfigSchema.partial()
    .extend({
      coalesce: CoalesceConfigSchema.partial().optional(),
    })
    .optional(),
  streaming: StreamingConfigSchema.partial().optional(),
  connection: ConnectionConfigSchema.partial().optional(),

  // Legacy flat paths (compatibility)
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  clientSecretFile: z.string().optional(),
  name: z.string().optional(),
  apiBase: z.string().optional(),
  openPath: z.string().optional(),
  subscriptionsJson: z.string().optional(),
  replyMode: z.enum(["text", "markdown"]).optional(),
  maxChars: z.number().min(200).max(8000).optional(),
  allowFrom: z.array(z.string()).optional(),
  selfUserId: z.string().optional(),
  requirePrefix: z.string().optional(),
  requireMention: z.boolean().optional(),
  isolateContextPerUserInGroup: z.boolean().optional(),
  mentionBypassUsers: z.array(z.string()).optional(),
  responsePrefix: z.string().optional(),
  tableMode: z.enum(["code", "off"]).optional(),
  coalesce: CoalesceConfigSchema.partial().optional(),
  showToolStatus: z.boolean().optional(),
  showToolResult: z.boolean().optional(),
  blockStreaming: z.boolean().optional(),
  streamBlockTextToSession: z.boolean().optional(),
  thinking: ThinkingLevelSchema.optional(),
  aiCard: AICardConfigSchema.partial().optional(),
});

/**
 * Canonical channel id + plugin id (used for config compatibility).
 */
export const DINGTALK_CHANNEL_ID = "clawdbot-dingtalk";
export const DINGTALK_PLUGIN_ID = "clawdbot-dingtalk";
export const DINGTALK_NPM_PACKAGE = "clawdbot-dingtalk";

/**
 * DingTalk channel configuration schema.
 * Maps from YAML config under `channels.dingtalk.*`
 */
export const DingTalkConfigSchema = z.object({
  /** Enable/disable the channel */
  enabled: z.boolean().default(true),

  // New grouped paths (preferred by Control UI)
  credentials: CredentialsConfigSchema.optional(),
  conversation: ConversationConfigSchema.optional(),
  reply: ReplyConfigSchema.optional(),
  streaming: StreamingConfigSchema.optional(),
  connection: ConnectionConfigSchema.optional(),

  // Legacy flat paths (compatibility)
  /** DingTalk app client ID (required) */
  clientId: z.string().optional(),

  /** DingTalk app client secret (required) */
  clientSecret: z.string().optional(),

  /** Path to file containing client secret */
  clientSecretFile: z.string().optional(),

  /** Display name for this account */
  name: z.string().optional(),

  /** DingTalk API base URL */
  apiBase: z.string().default("https://api.dingtalk.com"),

  /** Stream open path */
  openPath: z.string().default("/v1.0/gateway/connections/open"),

  /** Custom subscriptions JSON for stream */
  subscriptionsJson: z.string().optional(),

  /** Reply mode: text or markdown */
  replyMode: z.enum(["text", "markdown"]).default("text"),

  /** Maximum characters per message chunk */
  maxChars: z.number().min(200).max(8000).default(1800),

  /** Allowlist of sender IDs (empty = allow all) */
  allowFrom: z.array(z.string()).default([]),

  /** Bot's own user ID to skip self-messages */
  selfUserId: z.string().optional(),

  /** Require messages to start with this prefix (for group filtering) */
  requirePrefix: z.string().optional(),

  /** Require @机器人 in group chats (default: true) */
  requireMention: z.boolean().default(true),

  /** Isolate context per user in group chats (default: false) */
  isolateContextPerUserInGroup: z.boolean().default(false),

  /** Users who can bypass @mention requirement */
  mentionBypassUsers: z.array(z.string()).default([]),

  /** Prefix to add to response messages (supports {model}, {provider} vars) */
  responsePrefix: z.string().optional(),

  /** Table conversion mode for markdown */
  tableMode: z.enum(["code", "off"]).default("code"),

  /** Message coalescing configuration */
  coalesce: CoalesceConfigSchema.optional(),

  /** Show tool status messages (🔧 正在执行...) */
  showToolStatus: z.boolean().default(false),

  /** Show tool result messages (✅ ... 完成) */
  showToolResult: z.boolean().default(false),

  /** Enable block streaming for incremental replies */
  blockStreaming: z.boolean().default(true),

  /** Stream block text directly to sessionWebhook (instead of waiting final) */
  streamBlockTextToSession: z.boolean().default(true),

  /** Thinking mode for Clawdbot */
  thinking: ThinkingLevelSchema.default("off"),

  /** AI Card config */
  aiCard: AICardConfigSchema.optional(),

  /** Multi-account configuration */
  accounts: z
    .record(z.string(), DingTalkAccountOverrideSchema)
    .optional(),
});

export type DingTalkConfig = z.infer<typeof DingTalkConfigSchema>;
export type CoalesceConfig = z.infer<typeof CoalesceConfigSchema>;
export type AICardConfig = z.infer<typeof AICardConfigSchema>;
export type RateLimitConfig = z.infer<typeof ConversationConfigSchema>["rateLimit"];

/**
 * Default values for coalesce config
 */
export const DEFAULT_COALESCE: CoalesceConfig = {
  enabled: true,
  minChars: 800,
  maxChars: 1200,
  idleMs: 1000,
};

/**
 * Default account ID when not using multi-account
 */
export const DEFAULT_ACCOUNT_ID = "default";
