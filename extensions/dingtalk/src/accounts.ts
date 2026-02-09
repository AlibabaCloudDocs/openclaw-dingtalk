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
  blockStreaming: boolean;
  streamBlockTextToSession: boolean;

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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function getPathValue(source: Record<string, unknown> | undefined, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    const rec = asRecord(current);
    if (!rec) return undefined;
    current = rec[key];
  }
  return current;
}

function pickValue(
  source: Record<string, unknown> | undefined,
  paths: Array<string[]>
): unknown {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (value !== undefined) return value;
  }
  return undefined;
}

function pickString(source: Record<string, unknown> | undefined, paths: Array<string[]>): string | undefined {
  const value = pickValue(source, paths);
  return typeof value === "string" ? value : undefined;
}

function pickNumber(source: Record<string, unknown> | undefined, paths: Array<string[]>): number | undefined {
  const value = pickValue(source, paths);
  return typeof value === "number" ? value : undefined;
}

function pickBoolean(source: Record<string, unknown> | undefined, paths: Array<string[]>): boolean | undefined {
  const value = pickValue(source, paths);
  return typeof value === "boolean" ? value : undefined;
}

function pickStringArray(
  source: Record<string, unknown> | undefined,
  paths: Array<string[]>
): string[] | undefined {
  const value = pickValue(source, paths);
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function pickRecord(
  source: Record<string, unknown> | undefined,
  paths: Array<string[]>
): Record<string, unknown> | undefined {
  return asRecord(pickValue(source, paths));
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
  const sectionRecord = asRecord(section);

  const accountIds: string[] = [];

  // Check for base-level credentials (default account)
  const envClientId = process.env.DINGTALK_CLIENT_ID?.trim();
  const baseClientId = pickString(sectionRecord, [["credentials", "clientId"], ["clientId"]]);
  const baseClientSecretFile = pickString(sectionRecord, [
    ["credentials", "clientSecretFile"],
    ["clientSecretFile"],
  ]);
  const hasBaseCredentials = Boolean(baseClientId || baseClientSecretFile || envClientId);
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
  const sectionRecord = asRecord(section);

  // Merge base config with account-specific overrides
  const accountConfig = accountId !== DEFAULT_ACCOUNT_ID ? section?.accounts?.[accountId] : undefined;
  const accountRecord = asRecord(accountConfig);

  // Resolve credentials with priority: account > base > env
  const envClientId = process.env.DINGTALK_CLIENT_ID?.trim() ?? "";
  const envClientSecret = process.env.DINGTALK_CLIENT_SECRET?.trim() ?? "";

  let clientId = "";
  let clientSecret = "";
  let credentialSource: ResolvedDingTalkAccount["credentialSource"] = "none";

  // Try account-level first
  const accountClientId = pickString(accountRecord, [["credentials", "clientId"], ["clientId"]]);
  const accountClientSecret = pickString(accountRecord, [
    ["credentials", "clientSecret"],
    ["clientSecret"],
  ]);
  const accountClientSecretFile = pickString(accountRecord, [
    ["credentials", "clientSecretFile"],
    ["clientSecretFile"],
  ]);
  if (accountClientId) {
    clientId = accountClientId;
    if (accountClientSecret) {
      clientSecret = accountClientSecret;
      credentialSource = "config";
    } else if (accountClientSecretFile) {
      clientSecret = readSecretFile(accountClientSecretFile) ?? "";
      credentialSource = clientSecret ? "file" : "none";
    }
  }

  // Fall back to base-level
  const baseClientId = pickString(sectionRecord, [["credentials", "clientId"], ["clientId"]]);
  const baseClientSecret = pickString(sectionRecord, [["credentials", "clientSecret"], ["clientSecret"]]);
  const baseClientSecretFile = pickString(sectionRecord, [
    ["credentials", "clientSecretFile"],
    ["clientSecretFile"],
  ]);
  if (!clientId && baseClientId) {
    clientId = baseClientId;
    if (baseClientSecret) {
      clientSecret = baseClientSecret;
      credentialSource = "config";
    } else if (baseClientSecretFile) {
      clientSecret = readSecretFile(baseClientSecretFile) ?? "";
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
  const enabled = pickBoolean(accountRecord, [["enabled"]]) ?? pickBoolean(sectionRecord, [["enabled"]]) ?? true;
  const name =
    pickString(accountRecord, [["credentials", "name"], ["name"]]) ??
    pickString(sectionRecord, [["credentials", "name"], ["name"]]);
  const apiBase =
    pickString(accountRecord, [["connection", "apiBase"], ["apiBase"]]) ??
    pickString(sectionRecord, [["connection", "apiBase"], ["apiBase"]]) ??
    "https://api.dingtalk.com";
  const openPath =
    pickString(accountRecord, [["connection", "openPath"], ["openPath"]]) ??
    pickString(sectionRecord, [["connection", "openPath"], ["openPath"]]) ??
    "/v1.0/gateway/connections/open";
  const subscriptionsJson =
    pickString(accountRecord, [["connection", "subscriptionsJson"], ["subscriptionsJson"]]) ??
    pickString(sectionRecord, [["connection", "subscriptionsJson"], ["subscriptionsJson"]]);
  const replyMode =
    (pickString(accountRecord, [["reply", "replyMode"], ["replyMode"]]) ??
      pickString(sectionRecord, [["reply", "replyMode"], ["replyMode"]]) ??
      "text") as "text" | "markdown";
  const maxChars =
    pickNumber(accountRecord, [["reply", "maxChars"], ["maxChars"]]) ??
    pickNumber(sectionRecord, [["reply", "maxChars"], ["maxChars"]]) ??
    1800;
  const tableMode =
    (pickString(accountRecord, [["reply", "tableMode"], ["tableMode"]]) ??
      pickString(sectionRecord, [["reply", "tableMode"], ["tableMode"]]) ??
      "code") as "code" | "off";
  const allowFrom =
    pickStringArray(accountRecord, [["conversation", "allowFrom"], ["allowFrom"]]) ??
    pickStringArray(sectionRecord, [["conversation", "allowFrom"], ["allowFrom"]]) ??
    [];
  const selfUserId =
    pickString(accountRecord, [["credentials", "selfUserId"], ["selfUserId"]]) ??
    pickString(sectionRecord, [["credentials", "selfUserId"], ["selfUserId"]]);
  const requirePrefix =
    pickString(accountRecord, [["conversation", "requirePrefix"], ["requirePrefix"]]) ??
    pickString(sectionRecord, [["conversation", "requirePrefix"], ["requirePrefix"]]);
  const requireMention =
    pickBoolean(accountRecord, [["conversation", "requireMention"], ["requireMention"]]) ??
    pickBoolean(sectionRecord, [["conversation", "requireMention"], ["requireMention"]]) ??
    true;
  const isolateContextPerUserInGroup =
    pickBoolean(accountRecord, [
      ["conversation", "isolateContextPerUserInGroup"],
      ["isolateContextPerUserInGroup"],
    ]) ??
    pickBoolean(sectionRecord, [
      ["conversation", "isolateContextPerUserInGroup"],
      ["isolateContextPerUserInGroup"],
    ]) ??
    false;
  const mentionBypassUsers =
    pickStringArray(accountRecord, [["conversation", "mentionBypassUsers"], ["mentionBypassUsers"]]) ??
    pickStringArray(sectionRecord, [["conversation", "mentionBypassUsers"], ["mentionBypassUsers"]]) ??
    [];
  const responsePrefix =
    pickString(accountRecord, [["reply", "responsePrefix"], ["responsePrefix"]]) ??
    pickString(sectionRecord, [["reply", "responsePrefix"], ["responsePrefix"]]);
  const showToolStatus =
    pickBoolean(accountRecord, [["reply", "showToolStatus"], ["showToolStatus"]]) ??
    pickBoolean(sectionRecord, [["reply", "showToolStatus"], ["showToolStatus"]]) ??
    false;
  const showToolResult =
    pickBoolean(accountRecord, [["reply", "showToolResult"], ["showToolResult"]]) ??
    pickBoolean(sectionRecord, [["reply", "showToolResult"], ["showToolResult"]]) ??
    false;
  const blockStreaming =
    pickBoolean(accountRecord, [["streaming", "blockStreaming"], ["blockStreaming"]]) ??
    pickBoolean(sectionRecord, [["streaming", "blockStreaming"], ["blockStreaming"]]) ??
    true;
  const streamBlockTextToSession =
    pickBoolean(accountRecord, [["streaming", "streamBlockTextToSession"], ["streamBlockTextToSession"]]) ??
    pickBoolean(sectionRecord, [["streaming", "streamBlockTextToSession"], ["streamBlockTextToSession"]]) ??
    true;
  const thinking =
    (pickString(accountRecord, [["reply", "thinking"], ["thinking"]]) ??
      pickString(sectionRecord, [["reply", "thinking"], ["thinking"]]) ??
      "off") as "off" | "minimal" | "low" | "medium" | "high";

  const baseAICard: AICardConfig | undefined = section?.aiCard;
  const accountAICard: AICardConfig | undefined = asRecord(accountConfig)?.aiCard as AICardConfig | undefined;
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
  const baseCoalesce = pickRecord(sectionRecord, [["reply", "coalesce"], ["coalesce"]]);
  const accountCoalesce = pickRecord(accountRecord, [["reply", "coalesce"], ["coalesce"]]);
  const coalesce: CoalesceConfig = {
    enabled:
      (typeof accountCoalesce?.enabled === "boolean" ? accountCoalesce.enabled : undefined) ??
      (typeof baseCoalesce?.enabled === "boolean" ? baseCoalesce.enabled : undefined) ??
      DEFAULT_COALESCE.enabled,
    minChars:
      (typeof accountCoalesce?.minChars === "number" ? accountCoalesce.minChars : undefined) ??
      (typeof baseCoalesce?.minChars === "number" ? baseCoalesce.minChars : undefined) ??
      DEFAULT_COALESCE.minChars,
    maxChars:
      (typeof accountCoalesce?.maxChars === "number" ? accountCoalesce.maxChars : undefined) ??
      (typeof baseCoalesce?.maxChars === "number" ? baseCoalesce.maxChars : undefined) ??
      DEFAULT_COALESCE.maxChars,
    idleMs:
      (typeof accountCoalesce?.idleMs === "number" ? accountCoalesce.idleMs : undefined) ??
      (typeof baseCoalesce?.idleMs === "number" ? baseCoalesce.idleMs : undefined) ??
      DEFAULT_COALESCE.idleMs,
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
    blockStreaming,
    streamBlockTextToSession,
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
