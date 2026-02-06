import { readFileSync } from "node:fs";
type ClawdbotConfig = any;
import {
  type CoalesceConfig,
  type AICardConfig,
  type DingTalkConfig,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_COALESCE,
  DINGTALK_CHANNEL_ID,
} from "./config-schema.js";

/**
 * Resolved DingTalk account with normalized configuration.
 */
export type ResolvedDingTalkAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;

  // Credentials
  clientId: string;
  clientSecret: string;
  credentialSource: "env" | "config" | "file" | "none";

  // Connection settings
  apiBase: string;
  openPath: string;
  subscriptionsJson?: string;

  // Message handling
  replyMode: "text" | "markdown";
  maxChars: number;
  tableMode: "code" | "off";
  coalesce: CoalesceConfig;

  // Filtering
  allowFrom: string[];
  selfUserId?: string;
  requirePrefix?: string;
  requireMention: boolean;
  isolateContextPerUserInGroup: boolean;
  mentionBypassUsers: string[];

  // Response formatting
  responsePrefix?: string;
  showToolStatus: boolean;
  showToolResult: boolean;

  // AI settings
  thinking: "off" | "minimal" | "low" | "medium" | "high";

  // AI card settings
  aiCard: {
    enabled: boolean;
    templateId?: string;
    autoReply: boolean;
    textParamKey?: string;
    defaultCardData?: Record<string, unknown>;
    callbackType: "STREAM" | "HTTP";
    updateThrottleMs: number;
    fallbackReplyMode?: "text" | "markdown";
    openSpace?: Record<string, unknown>;
  };
};

/**
 * Read DingTalk config section from ClawdbotConfig
 */
function getDingTalkSection(cfg: ClawdbotConfig): DingTalkConfig | undefined {
  return (cfg.channels as Record<string, unknown>)?.[DINGTALK_CHANNEL_ID] as
    | DingTalkConfig
    | undefined;
}

/**
 * Try to read secret from file
 */
function readSecretFile(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return undefined;
  }
}

/**
 * List all configured account IDs.
 */
export function listDingTalkAccountIds(cfg: ClawdbotConfig): string[] {
  const section = getDingTalkSection(cfg);
  if (!section) return [];

  const accountIds: string[] = [];

  // Check for base-level credentials (default account)
  const envClientId = process.env.DINGTALK_CLIENT_ID?.trim();
  const hasBaseCredentials = Boolean(section.clientId || section.clientSecretFile || envClientId);
  if (hasBaseCredentials) {
    accountIds.push(DEFAULT_ACCOUNT_ID);
  }

  // Add named accounts
  if (section.accounts) {
    for (const id of Object.keys(section.accounts)) {
      if (!accountIds.includes(id)) {
        accountIds.push(id);
      }
    }
  }

  return accountIds;
}

/**
 * Resolve the default account ID.
 */
export function resolveDefaultDingTalkAccountId(cfg: ClawdbotConfig): string {
  const ids = listDingTalkAccountIds(cfg);
  return ids.length > 0 ? ids[0] : DEFAULT_ACCOUNT_ID;
}

/**
 * Resolve a specific DingTalk account by ID.
 */
export function resolveDingTalkAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedDingTalkAccount {
  const { cfg, accountId: rawAccountId } = params;
  const accountId = rawAccountId ?? DEFAULT_ACCOUNT_ID;
  const section = getDingTalkSection(cfg);

  // Merge base config with account-specific overrides
  const accountConfig =
    accountId !== DEFAULT_ACCOUNT_ID ? section?.accounts?.[accountId] : undefined;

  // Resolve credentials with priority: account > base > env
  const envClientId = process.env.DINGTALK_CLIENT_ID?.trim() ?? "";
  const envClientSecret = process.env.DINGTALK_CLIENT_SECRET?.trim() ?? "";

  let clientId = "";
  let clientSecret = "";
  let credentialSource: ResolvedDingTalkAccount["credentialSource"] = "none";

  // Try account-level first
  if (accountConfig?.clientId) {
    clientId = accountConfig.clientId;
    if (accountConfig.clientSecret) {
      clientSecret = accountConfig.clientSecret;
      credentialSource = "config";
    } else if (accountConfig.clientSecretFile) {
      clientSecret = readSecretFile(accountConfig.clientSecretFile) ?? "";
      credentialSource = clientSecret ? "file" : "none";
    }
  }

  // Fall back to base-level
  if (!clientId && section?.clientId) {
    clientId = section.clientId;
    if (section.clientSecret) {
      clientSecret = section.clientSecret;
      credentialSource = "config";
    } else if (section.clientSecretFile) {
      clientSecret = readSecretFile(section.clientSecretFile) ?? "";
      credentialSource = clientSecret ? "file" : "none";
    }
  }

  // Fall back to environment
  if (!clientId && envClientId) {
    clientId = envClientId;
    clientSecret = envClientSecret;
    credentialSource = clientId && clientSecret ? "env" : "none";
  }

  // Merge other settings with cascading priority
  const enabled = accountConfig?.enabled ?? section?.enabled ?? true;
  const name = accountConfig?.name ?? section?.name;
  const apiBase = accountConfig?.apiBase ?? section?.apiBase ?? "https://api.dingtalk.com";
  const openPath = accountConfig?.openPath ?? section?.openPath ?? "/v1.0/gateway/connections/open";
  const subscriptionsJson = accountConfig?.subscriptionsJson ?? section?.subscriptionsJson;
  const replyMode = accountConfig?.replyMode ?? section?.replyMode ?? "text";
  const maxChars = accountConfig?.maxChars ?? section?.maxChars ?? 1800;
  const tableMode = accountConfig?.tableMode ?? section?.tableMode ?? "code";
  const allowFrom = accountConfig?.allowFrom ?? section?.allowFrom ?? [];
  const selfUserId = accountConfig?.selfUserId ?? section?.selfUserId;
  const requirePrefix = accountConfig?.requirePrefix ?? section?.requirePrefix;
  const requireMention = accountConfig?.requireMention ?? section?.requireMention ?? true;
  const isolateContextPerUserInGroup =
    accountConfig?.isolateContextPerUserInGroup ??
    section?.isolateContextPerUserInGroup ??
    false;
  const mentionBypassUsers = accountConfig?.mentionBypassUsers ?? section?.mentionBypassUsers ?? [];
  const responsePrefix = accountConfig?.responsePrefix ?? section?.responsePrefix;
  const showToolStatus = accountConfig?.showToolStatus ?? section?.showToolStatus ?? false;
  const showToolResult = accountConfig?.showToolResult ?? section?.showToolResult ?? false;
  const thinking = accountConfig?.thinking ?? section?.thinking ?? "off";

  const baseAICard: AICardConfig | undefined = section?.aiCard;
  const accountAICard: AICardConfig | undefined = accountConfig?.aiCard;
  const aiCard = {
    enabled: accountAICard?.enabled ?? baseAICard?.enabled ?? false,
    templateId: accountAICard?.templateId ?? baseAICard?.templateId,
    autoReply: accountAICard?.autoReply ?? baseAICard?.autoReply ?? true,
    textParamKey: accountAICard?.textParamKey ?? baseAICard?.textParamKey,
    defaultCardData: accountAICard?.defaultCardData ?? baseAICard?.defaultCardData,
    callbackType: accountAICard?.callbackType ?? baseAICard?.callbackType ?? "STREAM",
    updateThrottleMs: accountAICard?.updateThrottleMs ?? baseAICard?.updateThrottleMs ?? 800,
    fallbackReplyMode: accountAICard?.fallbackReplyMode ?? baseAICard?.fallbackReplyMode,
    openSpace: accountAICard?.openSpace ?? baseAICard?.openSpace,
  };

  // Merge coalesce config
  const baseCoalesce = section?.coalesce ?? DEFAULT_COALESCE;
  const accountCoalesce = accountConfig?.coalesce;
  const coalesce: CoalesceConfig = {
    enabled: accountCoalesce?.enabled ?? baseCoalesce.enabled,
    minChars: accountCoalesce?.minChars ?? baseCoalesce.minChars,
    maxChars: accountCoalesce?.maxChars ?? baseCoalesce.maxChars,
    idleMs: accountCoalesce?.idleMs ?? baseCoalesce.idleMs,
  };

  return {
    accountId,
    name,
    enabled,
    clientId,
    clientSecret,
    credentialSource,
    apiBase,
    openPath,
    subscriptionsJson,
    replyMode,
    maxChars,
    tableMode,
    coalesce,
    allowFrom,
    selfUserId,
    requirePrefix,
    requireMention,
    isolateContextPerUserInGroup,
    mentionBypassUsers,
    responsePrefix,
    showToolStatus,
    showToolResult,
    thinking,
    aiCard,
  };
}

/**
 * Check if account has valid credentials
 */
export function isDingTalkAccountConfigured(account: ResolvedDingTalkAccount): boolean {
  return Boolean(account.clientId?.trim() && account.clientSecret?.trim());
}
