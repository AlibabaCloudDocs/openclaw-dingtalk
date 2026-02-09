/**
 * DingTalk monitor - starts the stream client and dispatches messages to Clawdbot.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
type ClawdbotConfig = any;
import { loadWebMedia } from "openclaw/plugin-sdk";
import type { ResolvedDingTalkAccount } from "./accounts.js";
import {
  getDingTalkRuntime,
  getOrCreateTokenManager,
  getCardStreamState,
  setCardStreamState,
  clearCardStreamState,
} from "./runtime.js";
import { startDingTalkStreamClient } from "./stream/client.js";
import type { ChatbotMessage, StreamClientHandle, StreamLogger, CardCallbackMessage } from "./stream/types.js";
import { buildSessionKey, startsWithPrefix } from "./stream/message-parser.js";
import { sendReplyViaSessionWebhook, sendImageViaSessionWebhook, sendImageWithMediaIdViaSessionWebhook } from "./send/reply.js";
import { convertMarkdownForDingTalk } from "./send/markdown.js";
import {
  stripDirectiveTags,
  stripDirectiveTagsPreserveFormatting,
  isOnlyDirectiveTags,
} from "./util/directive-tags.js";
import { applyResponsePrefix, isGroupChatType, shouldEnforcePrefix } from "./util/prefix.js";
import { DINGTALK_CHANNEL_ID } from "./config-schema.js";
import { downloadMedia, uploadMedia } from "./api/media.js";
import { uploadMediaToOAPI } from "./api/media-upload.js";
import { sendFileMessage, sendMediaByPath } from "./api/send-message.js";
import { createCardInstance, updateCardInstance, deliverCardInstance, streamCardInstance } from "./api/card-instances.js";
import { extractThinkDirective, extractThinkOnceDirective, type ThinkLevel } from "./util/think-directive.js";
import { parseMediaProtocol, hasMediaTags, replaceMediaTags } from "./media-protocol.js";
import { processMediaItems, uploadMediaItem } from "./send/media-sender.js";
import { DEFAULT_DINGTALK_SYSTEM_PROMPT, buildSenderContext } from "./system-prompt.js";
import type { DingTalkAICard } from "./types/channel-data.js";
import {
  buildCardDataFromText,
  buildFinishedCardData,
  buildInputingCardData,
  generateOutTrackId,
  normalizeOpenSpaceId,
  resolveCardUserId,
  resolveOpenSpace,
  resolveTemplateId,
} from "./util/ai-card.js";

export interface MonitorDingTalkOpts {
  account: ResolvedDingTalkAccount;
  config: ClawdbotConfig;
  abortSignal?: AbortSignal;
  log?: StreamLogger;
  statusSink?: (patch: Record<string, unknown>) => void;
}

/**
 * Derive provider name from model string.
 */
function deriveProvider(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
  if (m.includes("gpt") || m.includes("openai")) return "openai";
  if (m.includes("qwen") || m.includes("dashscope")) return "dashscope";
  if (m.includes("gemini") || m.includes("google")) return "google";
  if (m.includes("/")) return model.split("/")[0];
  return undefined;
}

type VerboseOverride = "off" | "on" | "full";

const ALLOWED_COMMAND_RE = /(?:^|\s)\/(new|think|thinking|reasoning|reason|model|models|verbose|v)(?=$|\s|:)/i;
const VERBOSE_COMMAND_RE = /(?:^|\s)\/(verbose|v)(?=$|\s|:)/i;
const RESET_COMMAND_RE = /(?:^|\s)\/new(?=$|\s|:)/i;
const BARE_NEW_COMMAND_RE = /^\/new$/i;
const DINGTALK_BARE_NEW_PROMPT_ZH =
  "你正在开始一个新会话。请使用中文打招呼并保持 1-3 句，询问用户接下来想做什么；如果当前运行模型与 system prompt 里的 default_model 不同，请顺带说明默认模型。不要提及内部步骤、文件、工具或推理。";

function inferMediaUrlFromStandaloneText(text: string): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;

  // Only treat as media when it's a single token. This prevents swallowing normal replies
  // that start with "/" (commands) or include paths embedded in sentences.
  if (/\s/.test(trimmed)) return undefined;

  if (/^(?:MEDIA:|attachment:\/\/)/.test(trimmed)) {
    return trimmed;
  }
  if (/^file:\/\//i.test(trimmed)) {
    return trimmed;
  }

  let candidatePath = trimmed;
  if (candidatePath.startsWith("~/")) {
    candidatePath = path.join(os.homedir(), candidatePath.slice(2));
  }

  const isWindowsAbs = /^[A-Za-z]:[\\/]/.test(candidatePath);
  const isUncPath = candidatePath.startsWith("\\\\");

  // If it resolves to an existing path, treat as media.
  // (existsSync is intentional: fast check, and loadWebMedia will validate further.)
  if (
    candidatePath.startsWith("/") ||
    candidatePath.startsWith("./") ||
    candidatePath.startsWith("../") ||
    trimmed.startsWith("~/") ||
    isWindowsAbs ||
    isUncPath
  ) {
    const resolved = path.isAbsolute(candidatePath)
      ? candidatePath
      : (isWindowsAbs || isUncPath)
        ? candidatePath
        : path.resolve(candidatePath);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  return undefined;
}

function injectChinesePromptForBareNewCommand(text: string): string {
  const trimmed = text.trim();
  if (!BARE_NEW_COMMAND_RE.test(trimmed)) {
    return text;
  }
  return `/new ${DINGTALK_BARE_NEW_PROMPT_ZH}`;
}

const REASONING_HEADER_RE = /^Reasoning:\s*/i;

function isReasoningPayload(text: string): boolean {
  const trimmed = text.trimStart();
  if (!REASONING_HEADER_RE.test(trimmed)) {
    return false;
  }
  const nonEmpty = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (nonEmpty.length < 2) {
    return false;
  }
  if (!REASONING_HEADER_RE.test(nonEmpty[0])) {
    return false;
  }
  return nonEmpty[1]?.startsWith("_") ?? false;
}

function softenReasoningMarkdown(text: string): string {
  const lines = text.split("\n");
  const firstNonEmpty = lines.find((line) => line.trim().length > 0);
  if (firstNonEmpty && firstNonEmpty.trimStart().startsWith(">")) {
    return text;
  }
  return lines.map((line) => (line.trim().length ? `> ${line}` : ">")).join("\n");
}

function hasAllowedCommandToken(text?: string): boolean {
  if (!text?.trim()) return false;
  return ALLOWED_COMMAND_RE.test(text);
}

function parseVerboseOverride(text?: string): VerboseOverride | undefined {
  if (!text?.trim()) return undefined;
  const match = text.match(VERBOSE_COMMAND_RE);
  if (!match || match.index === undefined) return undefined;

  let i = match.index + match[0].length;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] === ":") {
    i += 1;
    while (i < text.length && /\s/.test(text[i])) i += 1;
  }
  const argStart = i;
  while (i < text.length && /[A-Za-z-]/.test(text[i])) i += 1;
  const raw = argStart < i ? text.slice(argStart, i).toLowerCase() : "";
  if (!raw) return undefined;

  if (["off", "false", "no", "0", "disable", "disabled"].includes(raw)) return "off";
  if (["full", "all", "everything"].includes(raw)) return "full";
  if (["on", "true", "yes", "1", "minimal"].includes(raw)) return "on";
  return undefined;
}

function inferChatTypeFromOpenSpaceId(openSpaceId?: string): "group" | "direct" | undefined {
  if (!openSpaceId) return undefined;
  const lower = openSpaceId.toLowerCase();
  if (lower.includes("im_group")) return "group";
  if (lower.includes("im_robot") || lower.includes("im_single") || lower.includes("im_user")) return "direct";
  return undefined;
}

function extractConversationIdFromOpenSpaceId(openSpaceId?: string): string | undefined {
  if (!openSpaceId) return undefined;
  const match = openSpaceId.match(/im_group\.([^/;]+.*)$/i);
  if (match && match[1]) return match[1];
  return undefined;
}

/**
 * Ensure Openclaw can resolve channel-specific streaming config for this plugin.
 *
 * - Canonical channel id is `clawdbot-dingtalk` (DINGTALK_CHANNEL_ID).
 * - Older configs may still use `channels.dingtalk`.
 * - For block streaming, Openclaw's coalescer flushes per-enqueue when `chunkMode="newline"`.
 *   We default to newline here (unless explicitly configured) so block streaming actually streams.
 */
function ensureDingTalkStreamingConfig(cfg: ClawdbotConfig): ClawdbotConfig {
  const channelsRaw = (cfg as { channels?: unknown } | undefined)?.channels;
  const channels =
    channelsRaw && typeof channelsRaw === "object"
      ? (channelsRaw as Record<string, unknown>)
      : {};

  const canonicalRaw = channels[DINGTALK_CHANNEL_ID];
  const legacyRaw = (channels as Record<string, unknown>).dingtalk;
  const canonical =
    canonicalRaw && typeof canonicalRaw === "object"
      ? (canonicalRaw as Record<string, unknown>)
      : undefined;
  const legacy =
    legacyRaw && typeof legacyRaw === "object" ? (legacyRaw as Record<string, unknown>) : undefined;

  const explicitChunkMode = canonical?.chunkMode ?? legacy?.chunkMode;
  const chunkMode =
    explicitChunkMode === "newline" || explicitChunkMode === "length"
      ? explicitChunkMode
      : "newline";

  const nextCanonical = {
    ...(legacy ?? {}),
    ...(canonical ?? {}),
    chunkMode,
  };

  return {
    ...(cfg as Record<string, unknown>),
    channels: {
      ...channels,
      [DINGTALK_CHANNEL_ID]: nextCanonical,
    },
  };
}

type SessionStoreEntry = {
  sessionId?: string;
  sessionFile?: string;
};

function resolveOpenClawStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) {
    if (override.startsWith("~")) {
      return path.resolve(override.replace(/^~(?=$|[\\/])/, os.homedir()));
    }
    return path.resolve(override);
  }

  const candidates = [".openclaw", ".clawdbot", ".moltbot", ".moldbot"].map((dir) =>
    path.join(os.homedir(), dir)
  );
  return candidates.find((dir) => {
    try {
      return !!dir && existsSync(dir);
    } catch {
      return false;
    }
  }) ?? candidates[0];
}

function resolveSessionStorePath(agentId = "main"): string {
  return path.join(resolveOpenClawStateDir(), "agents", agentId, "sessions", "sessions.json");
}

function extractAssistantText(content: unknown): string | undefined {
  if (!content) {
    return undefined;
  }
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const textBlock = block as { type?: unknown; text?: unknown };
    if (textBlock.type === "text" && typeof textBlock.text === "string" && textBlock.text.trim()) {
      parts.push(textBlock.text);
    }
  }

  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("\n");
}

function resolveMessageTimestamp(
  entry: Record<string, unknown>,
  message: Record<string, unknown>
): number | undefined {
  const messageTs = message.timestamp;
  if (typeof messageTs === "number" && Number.isFinite(messageTs)) {
    return messageTs;
  }

  const entryTs = entry.timestamp;
  if (typeof entryTs === "string") {
    const parsed = Date.parse(entryTs);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeSilentFallbackText(raw?: string): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  if (isOnlyDirectiveTags(raw)) {
    return undefined;
  }
  const stripped = stripDirectiveTagsPreserveFormatting(raw);
  if (!stripped.trim()) {
    return undefined;
  }
  const trimmed = stripped.trim();
  if (/^(?:\.{1,2}\/|\/|~\/|file:\/\/|MEDIA:|attachment:\/\/)/i.test(trimmed)) {
    return undefined;
  }
  return stripped;
}

async function resolveSessionTranscriptPathBySessionKey(
  sessionKey: string,
  agentId = "main"
): Promise<string | undefined> {
  const storePath = resolveSessionStorePath(agentId);
  let parsed: Record<string, SessionStoreEntry> | undefined;

  try {
    const storeRaw = await readFile(storePath, "utf-8");
    parsed = JSON.parse(storeRaw) as Record<string, SessionStoreEntry>;
  } catch {
    return undefined;
  }

  const entry = parsed?.[sessionKey];
  if (!entry) {
    return undefined;
  }

  if (entry.sessionFile?.trim()) {
    const file = entry.sessionFile.trim();
    return path.isAbsolute(file) ? file : path.resolve(path.dirname(storePath), file);
  }

  if (!entry.sessionId?.trim()) {
    return undefined;
  }
  return path.join(path.dirname(storePath), `${entry.sessionId.trim()}.jsonl`);
}

async function readSilentRunFallbackFromTranscript(params: {
  sessionKey: string;
  runStartedAt: number;
  runEndedAt: number;
}): Promise<string | undefined> {
  const transcriptPath = await resolveSessionTranscriptPathBySessionKey(params.sessionKey);
  if (!transcriptPath) {
    return undefined;
  }

  let raw = "";
  try {
    raw = await readFile(transcriptPath, "utf-8");
  } catch {
    return undefined;
  }

  const lines = raw.split(/\r?\n/);
  const windowStart = params.runStartedAt - 30_000;
  const windowEnd = params.runEndedAt + 15_000;
  let fallbackText: string | undefined;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") {
      continue;
    }
    const message = entry.message as Record<string, unknown>;
    if (message.role !== "assistant") {
      continue;
    }

    const ts = resolveMessageTimestamp(entry, message);
    if (typeof ts !== "number") {
      continue;
    }
    if (ts < windowStart || ts > windowEnd) {
      continue;
    }

    const normalizedText = normalizeSilentFallbackText(
      extractAssistantText(message.content)
    );
    if (!normalizedText) {
      continue;
    }

    const isMirror =
      message.provider === "openclaw" &&
      message.model === "delivery-mirror" &&
      (message.stopReason === "stop" || message.stopReason === undefined);
    if (isMirror) {
      return normalizedText;
    }
    if (!fallbackText) {
      fallbackText = normalizedText;
    }
  }

  return fallbackText;
}

/**
 * Start monitoring DingTalk for incoming messages.
 */
export async function monitorDingTalkProvider(
  opts: MonitorDingTalkOpts
): Promise<StreamClientHandle> {
  const { account, config, abortSignal, log, statusSink } = opts;
  const runtime = getDingTalkRuntime();
  const dispatchConfig = ensureDingTalkStreamingConfig(config);

  // Parse custom subscriptions if provided
  let subscriptionsBody: Record<string, unknown> | null = null;
  if (account.subscriptionsJson?.trim()) {
    try {
      subscriptionsBody = JSON.parse(account.subscriptionsJson);
    } catch (err) {
      log?.warn?.({ err: (err as Error)?.message }, "Invalid subscriptions JSON");
    }
  }

  const openBody =
    subscriptionsBody ?? {
      clientId: account.clientId,
      clientSecret: account.clientSecret,
      subscriptions: [{ type: "CALLBACK", topic: "/v1.0/im/bot/messages/get" }],
    };

  // Track response prefix per session (only apply once per conversation)
  const prefixApplied = new Set<string>();
  // Track per-session verbose overrides for delivering non-final updates
  const verboseOverrides = new Map<string, VerboseOverride>();
  // Best-effort session-level thinking cache for one-shot restore.
  const thinkingLevels = new Map<string, ThinkLevel>();
  // Serialize per-session work to avoid overlapping Openclaw runs.
  // If we call dispatchReply concurrently for the same DingTalk session, Openclaw may reject the
  // second run as "already active", which triggers our silent fallback and causes:
  // 1) DingTalk receives unrelated/stale fallback text
  // 2) UI shows duplicates (fallback + later actual content)
  const oneshotChain = new Map<string, Promise<void>>();

  function enqueueSessionTask(sessionKey: string, task: () => Promise<void>): Promise<void> {
    const prev = oneshotChain.get(sessionKey) ?? Promise.resolve();
    const next = prev.then(task, task);
    // Track a "cleanup" promise in the chain, but swallow rejections so Node/Vitest
    // won't treat the tracked promise as an unhandled rejection.
    const tracked = next.finally(() => {
      if (oneshotChain.get(sessionKey) === tracked) {
        oneshotChain.delete(sessionKey);
      }
    });
    tracked.catch(() => {});
    oneshotChain.set(sessionKey, tracked);
    return next;
  }

  async function dispatchReply(opts: {
    ctx: Record<string, unknown>;
    dispatcherOptions: { deliver: (...args: any[]) => Promise<void> | void; onError?: (...args: any[]) => void };
  }): Promise<unknown> {
    return await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: opts.ctx,
      cfg: dispatchConfig,
      dispatcherOptions: opts.dispatcherOptions as any,
      replyOptions: {
        disableBlockStreaming: account.blockStreaming === false ? true : false,
        onReasoningStream: async (payload) => {
          if (!payload?.text && (!payload?.mediaUrls || payload.mediaUrls.length === 0)) {
            return;
          }
          await opts.dispatcherOptions.deliver(payload, { kind: "block" });
        },
      },
    });
  }

  async function maybeFinalizeLingeringAICardAfterDispatch(params: {
    sessionKey: string;
    dispatchResult?: unknown;
    dispatcherOptions: { deliver: (...args: any[]) => Promise<void> | void };
  }): Promise<void> {
    const state = getCardStreamState(params.sessionKey);
    if (!state) {
      return;
    }

    const countsRaw = (params.dispatchResult as { counts?: Record<string, unknown> } | undefined)?.counts;
    const hasCounts = Boolean(
      countsRaw &&
      typeof countsRaw === "object" &&
      typeof countsRaw.block === "number" &&
      typeof countsRaw.final === "number"
    );
    const shouldSynthesizeFinal = hasCounts
      ? ((countsRaw?.block as number) > 0 && (countsRaw?.final as number) === 0)
      : true;
    if (!shouldSynthesizeFinal) {
      return;
    }

    log?.warn?.(
      {
        sessionKey: params.sessionKey,
        outTrackId: state.outTrackId,
        counts: hasCounts
          ? {
              block: countsRaw?.block,
              final: countsRaw?.final,
            }
          : undefined,
        reason: "final_missing_after_block_stream",
      },
      "AI card stream appears to be missing final payload; emitting synthetic final"
    );

    try {
      await params.dispatcherOptions.deliver(
        { text: state.accumulatedText ?? "" },
        { kind: "final" }
      );
    } catch (err) {
      log?.error?.(
        {
          sessionKey: params.sessionKey,
          outTrackId: state.outTrackId,
          err: (err as Error)?.message ?? String(err),
        },
        "Synthetic AI card final delivery failed"
      );
    }
  }

  async function maybeHandleAICardDelivery(params: {
    payload: {
      text?: string;
      mediaUrl?: string;
      mediaUrls?: string[];
      channelData?: { dingtalk?: Record<string, unknown> };
    };
    info: { kind: string };
    chat: ChatbotMessage;
    sessionKey: string;
  }): Promise<{ handled: boolean; ok: boolean; delivered: boolean; error?: Error }> {
    const channelData = params.payload.channelData?.dingtalk as { card?: DingTalkAICard } | undefined;
    let card = channelData?.card;
    const isFinal = params.info.kind === "final";
    let didDeliver = false;

    const autoEnabled =
      account.aiCard.enabled &&
      account.aiCard.autoReply &&
      Boolean(account.aiCard.templateId);
    if (!card && !autoEnabled) {
      log?.debug?.(
        {
          aiCardEnabled: account.aiCard.enabled,
          aiCardAutoReply: account.aiCard.autoReply,
          hasTemplateId: Boolean(account.aiCard.templateId),
        },
        "Skipping AI card auto-reply (conditions not met)"
      );
      return { handled: false, ok: false, delivered: false };
    }

    // If the agent explicitly provided a card payload but the account disabled cards,
    // do not swallow the reply: fall back to regular text delivery.
    if (!account.aiCard.enabled) {
      if (card) {
        log?.warn?.(
          { sessionKey: params.sessionKey, kind: params.info.kind },
          "AI card payload ignored because aiCard is disabled; falling back to text reply"
        );
      }
      return { handled: false, ok: false, delivered: false, error: new Error("AI Card is disabled for this account.") };
    }

    const normalizeTextForCard = (text?: string): string => {
      const raw = text ?? "";
      if (!raw) return "";
      if (isOnlyDirectiveTags(raw)) return "";
      const stripped = stripDirectiveTagsPreserveFormatting(raw);
      if (!stripped.trim() && !stripped.includes("\n")) return "";
      return stripped;
    };

    const mergeAccumulatedText = (previous: string, next: string): string => {
      if (!next) return previous;
      if (!previous) return next;

      const newlineOnlyChunk = next.trim().length === 0 && next.includes("\n");
      if (next.startsWith(previous)) return next;
      if (previous.startsWith(next) && !newlineOnlyChunk) return previous;
      if (next.endsWith(previous)) return next;
      if (previous.endsWith(next) && !newlineOnlyChunk) return previous;
      if (next.includes(previous)) return next;
      if (previous.includes(next) && !newlineOnlyChunk) return previous;

      return `${previous}${next}`;
    };

    const chatIsGroup = isGroupChatType(params.chat.chatType);
    const cardUserId = resolveCardUserId(params.chat);
    const proactiveTarget = chatIsGroup
      ? (params.chat.conversationId ? `group:${params.chat.conversationId}` : undefined)
      : (cardUserId ? `user:${cardUserId}` : undefined);

    const tokenManager = getOrCreateTokenManager(account);
    const mediaErrors: string[] = [];
    let mediaSentCount = 0;

    const sendCardMedia = async (mediaUrl: string): Promise<void> => {
      const normalized = mediaUrl.trim();
      if (!normalized) return;
      if (!proactiveTarget) {
        mediaErrors.push(`missing target for ${normalized}`);
        return;
      }
      const sent = await sendMediaByPath({
        account,
        to: proactiveTarget,
        mediaUrl: normalized,
        tokenManager,
        logger: log,
      });
      if (sent.ok) {
        mediaSentCount += 1;
        didDeliver = true;
      } else {
        mediaErrors.push(`${normalized}: ${sent.error?.message ?? "send failed"}`);
      }
    };

    let cardText = normalizeTextForCard(params.payload.text);
    if (params.payload.mediaUrl?.trim()) {
      await sendCardMedia(params.payload.mediaUrl);
    }
    if (Array.isArray(params.payload.mediaUrls)) {
      for (const url of params.payload.mediaUrls) {
        if (typeof url === "string" && url.trim()) {
          await sendCardMedia(url);
        }
      }
    }
    if (cardText && hasMediaTags(cardText)) {
      const parsed = parseMediaProtocol(cardText);
      cardText = parsed.cleanedContent;
      for (const item of parsed.items) {
        if (item.type === "image" || item.type === "file") {
          await sendCardMedia(item.path);
          continue;
        }
        log?.info?.({ type: item.type, path: item.path }, "Skipping unsupported AI card media item");
      }
    }

    if (!cardText && mediaSentCount > 0) {
      cardText = "✅ 媒体已发送";
    }
    if (mediaErrors.length > 0) {
      const mediaErrorSummary = `⚠️ 媒体发送失败: ${mediaErrors.join("; ")}`;
      cardText = cardText ? `${cardText}\n\n${mediaErrorSummary}` : mediaErrorSummary;
    }

    if (!card) {
      const allowAuto = autoEnabled && Boolean(cardText);
      if (!allowAuto) {
        log?.debug?.(
          {
            aiCardEnabled: account.aiCard.enabled,
            aiCardAutoReply: account.aiCard.autoReply,
            hasTemplateId: Boolean(account.aiCard.templateId),
            hasText: Boolean(cardText),
          },
          "Skipping AI card auto-reply (conditions not met)"
        );
        return { handled: false, ok: false, delivered: false };
      }

      card = {
        cardData: buildCardDataFromText({
          account,
          text: cardText,
        }),
      };
    }

    const templateId = resolveTemplateId(account, card);
    if (!templateId) {
      return { handled: true, ok: false, delivered: false, error: new Error("Missing AI card templateId.") };
    }

    if (!card.cardData) {
      return { handled: true, ok: false, delivered: false, error: new Error("Missing AI card cardData.") };
    }

    const { openSpace, openSpaceId } = resolveOpenSpace({ account, card, chat: params.chat });
    if (!openSpace && !openSpaceId) {
      return {
        handled: true,
        ok: false,
        delivered: false,
        error: new Error("Missing openSpace/openSpaceId for AI card delivery."),
      };
    }

    const stream = card.stream !== false;
    const now = Date.now();
    const throttleMs = Math.max(0, account.aiCard.updateThrottleMs);
    const previousState = getCardStreamState(params.sessionKey);
    const outTrackId = card.outTrackId ?? previousState?.outTrackId ?? generateOutTrackId("card");
    const callbackType = card.callbackType ?? account.aiCard.callbackType;
    const contentKey =
      card.contentKey?.trim() ||
      previousState?.contentKey ||
      account.aiCard.textParamKey ||
      "msgContent";
    const mergedText = mergeAccumulatedText(
      previousState?.accumulatedText ?? "",
      cardText
    );
    log?.debug?.(
      {
        sessionKey: params.sessionKey,
        outTrackId,
        kind: params.info.kind,
        chunkLen: cardText.length,
        chunkHasNewline: cardText.includes("\n"),
        accumulatedLen: mergedText.length,
      },
      "AI card text chunk processed"
    );
    const defaultFinalText = mediaSentCount > 0 ? "✅ 媒体已发送" : "";

    const baseState = {
      cardInstanceId: card.cardInstanceId ?? previousState?.cardInstanceId,
      outTrackId,
      templateId,
      inputingStarted: previousState?.inputingStarted ?? false,
      delivered: previousState?.delivered ?? false,
      contentKey,
      accumulatedText: mergedText,
      finalizedAt: previousState?.finalizedAt,
      lastUpdateAt: previousState?.lastUpdateAt ?? 0,
    };

    const fail = (stage: string, error?: Error) => {
      const fallbackError = error ?? new Error(`AI card stage failed: ${stage}`);
      log?.error?.(
        {
          stage,
          sessionKey: params.sessionKey,
          outTrackId,
          err: fallbackError.message,
        },
        "AI card delivery stage failed"
      );
      clearCardStreamState(params.sessionKey);
      return { handled: true, ok: false, delivered: didDeliver, error: fallbackError };
    };

    if (!stream && !isFinal) {
      return { handled: true, ok: true, delivered: false };
    }
    const isGroup = isGroupChatType(params.chat.chatType);
    const senderId = params.chat.senderId;
    const normalizedOpenSpaceId = normalizeOpenSpaceId(openSpaceId);
    const baseOpenSpace = (openSpace ?? {}) as Record<string, unknown>;
    const existingGroupSpace = (baseOpenSpace as Record<string, any>).imGroupOpenSpaceModel;
    const existingRobotSpace = (baseOpenSpace as Record<string, any>).imRobotOpenSpaceModel;

    const openSpaceCreatePayload = isGroup
      ? {
          ...baseOpenSpace,
          imGroupOpenSpaceModel: {
            ...(existingGroupSpace ?? {}),
            supportForward: true,
          },
        }
      : {
          ...baseOpenSpace,
          imRobotOpenSpaceModel: {
            ...(existingRobotSpace ?? {}),
            userId: (existingRobotSpace as any)?.userId ?? cardUserId,
            supportForward: true,
          },
        };

    if (!stream) {
      const finalText = mergedText.trim() ? mergedText : defaultFinalText;
      const finalCardData = buildFinishedCardData({
        account,
        text: finalText,
        baseCardData: card.cardData,
      });

      const preferUpdate =
        card.mode === "update" || Boolean(card.cardInstanceId) || Boolean(previousState?.cardInstanceId);
      if (preferUpdate) {
        const updated = await updateCardInstance({
          account,
          cardInstanceId: card.cardInstanceId ?? previousState?.cardInstanceId,
          outTrackId,
          cardData: finalCardData,
          privateData: card.privateData,
          openSpace,
          openSpaceId: normalizedOpenSpaceId,
          callbackType,
          tokenManager,
          logger: log,
        });
        clearCardStreamState(params.sessionKey);
        return { handled: true, ok: updated.ok, delivered: updated.ok, error: updated.error };
      }

      const created = await createCardInstance({
        account,
        templateId,
        outTrackId,
        cardData: finalCardData,
        privateData: card.privateData,
        openSpace: openSpaceCreatePayload,
        openSpaceId: normalizedOpenSpaceId,
        callbackType,
        tokenManager,
        logger: log,
      });
      if (!created.ok) {
        return fail("create", created.error);
      }

      if (!normalizedOpenSpaceId) {
        return fail("resolveOpenSpace", new Error("Missing openSpaceId for AI card deliver."));
      }
      const deliver = await deliverCardInstance({
        account,
        outTrackId,
        openSpaceId: normalizedOpenSpaceId,
        userIdType: 1,
        imGroupOpenDeliverModel: isGroup
          ? {
              robotCode: account.clientId,
              recipients: senderId ? [senderId] : undefined,
            }
          : undefined,
        imRobotOpenDeliverModel: !isGroup
          ? {
              spaceType: "IM_ROBOT",
              robotCode: account.clientId,
              userIds: cardUserId ? [cardUserId] : undefined,
            }
          : undefined,
        tokenManager,
        logger: log,
      });
      clearCardStreamState(params.sessionKey);
      return { handled: true, ok: deliver.ok, delivered: deliver.ok, error: deliver.error };
    }

    let state = { ...baseState };

    if (!state.delivered) {
      const created = await createCardInstance({
        account,
        templateId,
        outTrackId: state.outTrackId,
        cardData: card.cardData,
        privateData: card.privateData,
        openSpace: openSpaceCreatePayload,
        openSpaceId: normalizedOpenSpaceId,
        callbackType,
        tokenManager,
        logger: log,
      });
      if (!created.ok) {
        return fail("create", created.error);
      }
      if (!normalizedOpenSpaceId) {
        return fail("resolveOpenSpace", new Error("Missing openSpaceId for AI card deliver."));
      }
      const deliver = await deliverCardInstance({
        account,
        outTrackId: state.outTrackId,
        openSpaceId: normalizedOpenSpaceId,
        userIdType: 1,
        imGroupOpenDeliverModel: isGroup
          ? {
              robotCode: account.clientId,
              recipients: senderId ? [senderId] : undefined,
            }
          : undefined,
        imRobotOpenDeliverModel: !isGroup
          ? {
              spaceType: "IM_ROBOT",
              robotCode: account.clientId,
              userIds: cardUserId ? [cardUserId] : undefined,
            }
          : undefined,
        tokenManager,
        logger: log,
      });
      if (!deliver.ok) {
        return fail("deliver", deliver.error);
      }
      didDeliver = true;
      state = {
        ...state,
        cardInstanceId: created.cardInstanceId ?? state.cardInstanceId,
        delivered: true,
      };
    }

    if (!state.inputingStarted) {
      const inputingData = buildInputingCardData({
        account,
        text: state.accumulatedText ?? "",
        baseCardData: card.cardData,
      });
      const inputingResult = await updateCardInstance({
        account,
        cardInstanceId: state.cardInstanceId,
        outTrackId: state.outTrackId,
        cardData: inputingData,
        privateData: card.privateData,
        openSpace,
        openSpaceId: normalizedOpenSpaceId,
        callbackType,
        tokenManager,
        logger: log,
      });
      if (!inputingResult.ok) {
        return fail("inputing", inputingResult.error);
      }
      didDeliver = true;
      state = { ...state, inputingStarted: true };
    }

    const shouldSendStreaming =
      isFinal || !state.lastUpdateAt || now - state.lastUpdateAt >= throttleMs;

    if (shouldSendStreaming) {
      const content = state.accumulatedText?.trim()
        ? state.accumulatedText
        : defaultFinalText;
      const streaming = await streamCardInstance({
        account,
        outTrackId: state.outTrackId,
        key: state.contentKey,
        content: content ?? "",
        isFull: true,
        isFinalize: isFinal,
        tokenManager,
        logger: log,
      });
      if (!streaming.ok) {
        return fail("streaming", streaming.error);
      }
      didDeliver = true;
      state = {
        ...state,
        lastUpdateAt: now,
      };
    }

    if (isFinal) {
      const finalText = state.accumulatedText?.trim()
        ? state.accumulatedText
        : defaultFinalText;
      const finishedData = buildFinishedCardData({
        account,
        text: finalText ?? "",
        baseCardData: card.cardData,
      });
      const finished = await updateCardInstance({
        account,
        cardInstanceId: state.cardInstanceId,
        outTrackId: state.outTrackId,
        cardData: finishedData,
        privateData: card.privateData,
        openSpace,
        openSpaceId: normalizedOpenSpaceId,
        callbackType,
        tokenManager,
        logger: log,
      });
      if (!finished.ok) {
        return fail("finish", finished.error);
      }
      didDeliver = true;
      clearCardStreamState(params.sessionKey);
      return { handled: true, ok: true, delivered: true };
    }

    setCardStreamState(params.sessionKey, state);
    return { handled: true, ok: true, delivered: didDeliver };
  }

  const client = await startDingTalkStreamClient({
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    apiBase: account.apiBase,
    openPath: account.openPath,
    openBody,
    logger: log,
    onConnectionStatus: (status) => {
      if (status.connected) {
        statusSink?.({ connected: true, lastConnectedAt: status.ts, lastError: null });
      } else {
        statusSink?.({ connected: false, lastDisconnect: status.ts });
      }
    },
    onChatMessage: async (chat: ChatbotMessage) => {
      try {
        statusSink?.({ lastInboundAt: Date.now() });
        await handleInboundMessage(chat);
      } catch (err) {
        log?.error?.({ err: { message: (err as Error)?.message } }, "Handler error");
        statusSink?.({ lastError: (err as Error)?.message ?? String(err) });
      }
    },
    onCardCallback: async (callback: CardCallbackMessage) => {
      try {
        await handleCardCallback(callback);
      } catch (err) {
        log?.error?.({ err: { message: (err as Error)?.message } }, "Card callback handler error");
        statusSink?.({ lastError: (err as Error)?.message ?? String(err) });
      }
    },
  });

  // Handle abort signal
  if (abortSignal) {
    abortSignal.addEventListener(
      "abort",
      () => {
        log?.info?.("Abort signal received, stopping DingTalk stream");
        client.stop();
      },
      { once: true }
    );
  }

  async function handleInboundMessage(
    chat: ChatbotMessage,
    opts: {
      metadata?: Record<string, unknown>;
      bypassPrefix?: boolean;
      bypassMention?: boolean;
      forceCommandAuthorized?: boolean;
    } = {}
  ): Promise<void> {
    const isGroup = isGroupChatType(chat.chatType);

    // Filter: skip self messages
    if (account.selfUserId && chat.senderId === account.selfUserId) {
      return;
    }

    // Filter: allowlist
    if (account.allowFrom.length > 0 && chat.senderId) {
      if (!account.allowFrom.includes(chat.senderId)) {
        log?.info?.({ senderId: chat.senderId }, "Blocked sender (not in allowlist)");
        return;
      }
    }

    // Filter: require prefix (for group chats)
    if (!opts.bypassPrefix && shouldEnforcePrefix(account.requirePrefix, chat.chatType) && !startsWithPrefix(chat.text, account.requirePrefix)) {
      return;
    }

    // Filter: require @mention in group chats (if requireMention is enabled and no requirePrefix)
    if (!opts.bypassMention && isGroup && account.requireMention && !account.requirePrefix) {
      // Check if sender is in bypass list
      const isBypassUser = account.mentionBypassUsers.length > 0 &&
        account.mentionBypassUsers.includes(chat.senderId);

      if (!isBypassUser && !chat.isInAtList) {
        log?.debug?.({ senderId: chat.senderId, conversationId: chat.conversationId }, "Skipping (not mentioned in group)");
        return;
      }
    }

    const textForAgent = injectChinesePromptForBareNewCommand(chat.text);

    const sessionKey = buildSessionKey(chat, "main", {
      isolateGroupBySender: account.isolateContextPerUserInGroup,
    });
    const commandAuthorized = opts.forceCommandAuthorized ?? hasAllowedCommandToken(textForAgent);

    if (RESET_COMMAND_RE.test(textForAgent)) {
      verboseOverrides.delete(sessionKey);
      thinkingLevels.delete(sessionKey);
      clearCardStreamState(sessionKey);
    }
    const verboseOverride = parseVerboseOverride(textForAgent);
    if (verboseOverride) {
      verboseOverrides.set(sessionKey, verboseOverride);
    }
    const allowNonFinal =
      verboseOverrides.get(sessionKey) === "off"
        ? false
        : verboseOverrides.has(sessionKey)
          ? true
          : account.showToolStatus || account.showToolResult;
    // Initialized early for fallback helpers, but reset again when the queued work actually starts.
    let runStartedAt = Date.now();
    const aiCardAutoReplyEnabled =
      account.aiCard.enabled &&
      account.aiCard.autoReply &&
      Boolean(account.aiCard.templateId);
    const runDeliveryState = {
      deliveredCount: 0,
      lastTextCandidate: undefined as string | undefined,
      fallbackSent: false,
    };
    const blockTextBufferState = {
      sawBlockText: false,
      accumulatedText: "",
      finalTextDelivered: false,
      synthesizedFinalSent: false,
    };
    const mergeBufferedBlockText = (previous: string, next: string): string => {
      if (!next) return previous;
      if (!previous) return next;
      if (next.startsWith(previous)) return next;
      if (previous.startsWith(next)) return previous;
      if (next.endsWith(previous)) return next;
      if (previous.endsWith(next)) return previous;
      if (next.includes(previous)) return next;
      if (previous.includes(next)) return previous;
      return `${previous}${next}`;
    };
    const rememberBufferedBlockText = (text?: string): void => {
      const normalized = normalizeSilentFallbackText(text);
      if (!normalized) {
        return;
      }
      blockTextBufferState.sawBlockText = true;
      blockTextBufferState.accumulatedText = mergeBufferedBlockText(
        blockTextBufferState.accumulatedText,
        normalized
      );
    };
    const maybeSendBufferedBlockTextFinal = async (
      dispatchResult: unknown,
      dispatcherOptions: {
        deliver: (
          payload: {
            text?: string;
            mediaUrls?: string[];
            mediaUrl?: string;
            replyToId?: string;
            channelData?: { dingtalk?: Record<string, unknown> };
          },
          info: { kind: string }
        ) => Promise<void> | void;
      }
    ): Promise<void> => {
      if (account.streamBlockTextToSession) {
        return;
      }
      if (aiCardAutoReplyEnabled) {
        return;
      }
      if (
        !blockTextBufferState.sawBlockText ||
        blockTextBufferState.finalTextDelivered ||
        blockTextBufferState.synthesizedFinalSent
      ) {
        return;
      }

      const text = blockTextBufferState.accumulatedText.trim()
        ? blockTextBufferState.accumulatedText
        : undefined;
      if (!text) {
        return;
      }

      const countsRaw = (dispatchResult as { counts?: Record<string, unknown> } | undefined)?.counts;
      const hasCounts = Boolean(
        countsRaw &&
        typeof countsRaw === "object" &&
        typeof countsRaw.block === "number" &&
        typeof countsRaw.final === "number"
      );
      const shouldSynthesizeFinal = hasCounts
        ? ((countsRaw?.block as number) > 0 && (countsRaw?.final as number) === 0)
        : true;
      if (!shouldSynthesizeFinal) {
        return;
      }

      log?.warn?.(
        {
          sessionKey,
          counts: hasCounts
            ? {
                block: countsRaw?.block,
                final: countsRaw?.final,
              }
            : undefined,
          reason: "final_missing_after_block_stream",
        },
        "Session reply appears to be missing final payload; emitting synthetic final"
      );

      await dispatcherOptions.deliver({ text }, { kind: "final" });
      blockTextBufferState.synthesizedFinalSent = true;
    };
    const markDelivered = (reason: string): void => {
      runDeliveryState.deliveredCount += 1;
      statusSink?.({ lastOutboundAt: Date.now() });
      log?.debug?.(
        {
          sessionKey,
          reason,
          deliveredCount: runDeliveryState.deliveredCount,
        },
        "DingTalk delivery marked"
      );
    };
    const rememberTextCandidate = (text?: string): void => {
      const normalized = normalizeSilentFallbackText(text);
      if (!normalized) {
        return;
      }
      runDeliveryState.lastTextCandidate = normalized;
    };
    const maybeSendSilentRunFallback = async (): Promise<void> => {
      if (runDeliveryState.fallbackSent || runDeliveryState.deliveredCount > 0) {
        return;
      }
      if (!chat.sessionWebhook?.trim()) {
        return;
      }

      const runEndedAt = Date.now();
      let fallbackText = await readSilentRunFallbackFromTranscript({
        sessionKey,
        runStartedAt,
        runEndedAt,
      });
      if (!fallbackText) {
        fallbackText = normalizeSilentFallbackText(runDeliveryState.lastTextCandidate);
      }
      if (!fallbackText) {
        return;
      }

      const fallbackReply = await sendReplyViaSessionWebhook(chat.sessionWebhook, fallbackText, {
        replyMode: account.replyMode,
        maxChars: account.maxChars,
        tableMode: account.tableMode,
        logger: log,
      });
      if (fallbackReply.ok) {
        runDeliveryState.fallbackSent = true;
        markDelivered("silent_run_fallback");
        log?.warn?.(
          {
            sessionKey,
            runStartedAt,
            runEndedAt,
          },
          "No DingTalk delivery observed during run; sent final fallback from transcript"
        );
      }
    };

    log?.info?.(
      {
        messageId: chat.messageId,
        eventType: chat.eventType,
        senderId: chat.senderId,
        senderName: chat.senderName,
        conversationId: chat.conversationId,
        chatType: chat.chatType,
        sessionKey,
      },
      "Inbound DingTalk message"
    );

    // Build inbound context for Clawdbot
    // Inject senderStaffId into BodyForAgent so AI can use it for cron tasks
    const senderContext = buildSenderContext(chat.senderId) + "\n";

    // One-shot thinking directive: /t! on|off|minimal|low|medium|high ...
    // This is handled by the channel (not OpenClaw), so we strip it from the prompt.
    const onceThink = extractThinkOnceDirective(textForAgent);
    const hasOnceThink =
      onceThink.hasDirective &&
      onceThink.thinkLevel !== undefined &&
      onceThink.cleaned.trim().length > 0;

    // Track persistent /think directive in a local cache (best-effort) so one-shot can restore.
    const persistentThink = extractThinkDirective(textForAgent);
    if (persistentThink.hasDirective && persistentThink.thinkLevel !== undefined) {
      if (persistentThink.thinkLevel === "off") {
        thinkingLevels.delete(sessionKey);
      } else {
        thinkingLevels.set(sessionKey, persistentThink.thinkLevel);
      }
    }

    // Handle file messages - download and include file URL in context
    let fileContext = "";
    if (chat.downloadCode) {
      log?.info?.({ downloadCode: chat.downloadCode?.slice(0, 20), fileName: chat.fileName }, "Processing file message");
      try {
        const tokenManager = getOrCreateTokenManager(account);
        const downloadResult = await downloadMedia({
          account,
          downloadCode: chat.downloadCode,
          tokenManager,
          logger: log,
        });
        if (downloadResult.ok && downloadResult.url) {
          fileContext = `\n[文件: ${chat.fileName ?? "附件"}]\n下载链接: ${downloadResult.url}\n`;
          log?.debug?.({ fileName: chat.fileName, url: downloadResult.url?.slice(0, 50) }, "File download URL obtained");
        } else {
          fileContext = `\n[文件: ${chat.fileName ?? "附件"}] (下载失败)\n`;
          log?.warn?.({ err: downloadResult.error?.message }, "Failed to get file download URL");
        }
      } catch (err) {
        log?.error?.({ err: { message: (err as Error)?.message } }, "Error processing file message");
        fileContext = `\n[文件: ${chat.fileName ?? "附件"}] (处理失败)\n`;
      }
    }

    // Handle image messages - include image URL in context
    let imageContext = "";
    if (chat.picUrl) {
      log?.info?.({ picUrl: chat.picUrl?.slice(0, 50) }, "Processing image message");
      // For images, picUrl might be a downloadCode or direct URL
      if (chat.picUrl.startsWith("http")) {
        imageContext = `\n[图片: ${chat.picUrl}]\n`;
      } else {
        // picUrl is a downloadCode, need to get actual URL
        try {
          const tokenManager = getOrCreateTokenManager(account);
          const downloadResult = await downloadMedia({
            account,
            downloadCode: chat.picUrl,
            tokenManager,
            logger: log,
          });
          if (downloadResult.ok && downloadResult.url) {
            imageContext = `\n[图片: ${downloadResult.url}]\n`;
            log?.debug?.({ url: downloadResult.url?.slice(0, 50) }, "Image download URL obtained");
          } else {
            imageContext = `\n[图片] (下载失败)\n`;
            log?.warn?.({ err: downloadResult.error?.message }, "Failed to get image download URL");
          }
        } catch (err) {
          log?.error?.({ err: { message: (err as Error)?.message } }, "Error processing image message");
          imageContext = `\n[图片] (处理失败)\n`;
        }
      }
    }

    const effectiveText = hasOnceThink ? onceThink.cleaned : textForAgent;
    const messageBody = effectiveText + fileContext + imageContext;

    // Build DingTalk channel system prompt (injected into agent context)
    const channelSystemPrompt = `${DEFAULT_DINGTALK_SYSTEM_PROMPT}\n\n---\n\n`;

    const ctx = {
      Body: messageBody,
      RawBody: effectiveText,
      CommandBody: effectiveText,
      BodyForAgent: channelSystemPrompt + senderContext + messageBody,
      BodyForCommands: effectiveText,
      From: chat.senderId,
      To: chat.conversationId,
      SessionKey: sessionKey,
      AccountId: account.accountId,
      MessageSid: chat.messageId,
      ChatType: isGroup ? "group" : "direct",
      SenderName: chat.senderName,
      SenderId: chat.senderId,
      CommandAuthorized: commandAuthorized,
      Provider: DINGTALK_CHANNEL_ID,
      Surface: DINGTALK_CHANNEL_ID,
      OriginatingChannel: DINGTALK_CHANNEL_ID,
      OriginatingTo: chat.conversationId,
      Timestamp: Date.now(),
      metadata: opts.metadata,
      Metadata: opts.metadata,
    };

    // Create reply dispatcher that sends to DingTalk
    // The dispatcher uses `deliver` function with ReplyPayload signature
    let firstReply = true;
    const dispatcherOptions = {
      deliver: async (
        payload: {
          text?: string;
          mediaUrls?: string[];
          mediaUrl?: string;
          replyToId?: string;
          channelData?: { dingtalk?: Record<string, unknown> };
        },
        info: { kind: string }
      ) => {
        log?.info?.({ kind: info.kind, hasText: !!payload.text, textLength: payload.text?.length ?? 0 }, "deliver called");
        rememberTextCandidate(payload.text);

        const cardResult = await maybeHandleAICardDelivery({
          payload,
          info,
          chat,
          sessionKey,
        });
        if (cardResult.handled) {
          if (cardResult.delivered) {
            markDelivered("ai_card");
          }
          if (!cardResult.ok && payload.text?.trim()) {
            const fallbackMode = account.aiCard.fallbackReplyMode ?? account.replyMode;
            log?.warn?.(
              {
                reason: cardResult.error?.message,
                fallbackMode,
              },
              "AI card delivery failed, falling back to text reply"
            );
            const fallbackReply = await sendReplyViaSessionWebhook(chat.sessionWebhook, payload.text, {
              replyMode: fallbackMode,
              maxChars: account.maxChars,
              tableMode: account.tableMode,
              logger: log,
            });
            if (fallbackReply.ok) {
              markDelivered("ai_card_text_fallback");
            }
          }
          return;
        }

        const shouldBufferBlockText =
          info.kind === "block" && account.streamBlockTextToSession === false;
        if (shouldBufferBlockText) {
          rememberBufferedBlockText(payload.text);
        }

        // Allow "block" kind messages if they have text and block text streaming is enabled
        const isBlockWithText = info.kind === "block" && !!payload.text?.trim();

        // Allow media deliveries even when verbose is off (e.g., tool-kind images).
        const explicitMediaUrl = payload.mediaUrl || payload.mediaUrls?.[0];
        const trimmedText = payload.text?.trim();
        const derivedMediaUrl =
          !explicitMediaUrl && trimmedText
            ? inferMediaUrlFromStandaloneText(trimmedText)
            : undefined;
        const mediaUrl = explicitMediaUrl || derivedMediaUrl;

        const allowText =
          info.kind === "final" ||
          allowNonFinal ||
          (isBlockWithText && account.streamBlockTextToSession);
        const skipText = !allowText;

        if (skipText && !mediaUrl) {
          log?.debug?.({ kind: info.kind, sessionKey }, "Skipping non-final reply (verbose off)");
          return;
        }

        // Handle image/media URLs - send as rendered images
        if (mediaUrl) {
          log?.info?.({ mediaUrl: mediaUrl.slice(0, 80) }, "Processing media for DingTalk");

          // Check if it's an HTTP URL or a local path
          const isHttpUrl = /^https?:\/\//i.test(mediaUrl);

          if (isHttpUrl) {
            // HTTP URL - send directly via sessionWebhook
            log?.debug?.({ mediaUrl: mediaUrl.slice(0, 50) }, "Sending HTTP image to DingTalk");
            const imageResult = await sendImageViaSessionWebhook(chat.sessionWebhook, mediaUrl, { logger: log });
            if (imageResult.ok) {
              markDelivered("image_http");
            }
          } else {
            // Local file path - need to upload first
            log?.info?.({ mediaUrl: mediaUrl.slice(0, 80) }, "Loading local media file");
            try {
              // Load the local file
              const media = await loadWebMedia(mediaUrl);
              const isImage =
                media.kind === "image" || /^image\//i.test(media.contentType ?? "");
              log?.debug?.({
                contentType: media.contentType,
                size: media.buffer.length,
                fileName: media.fileName
              }, "Local media loaded");

              const tokenManager = getOrCreateTokenManager(account);

              if (isImage) {
                // For local images, upload via OAPI to get a sessionWebhook-compatible media_id.
                const fileName = media.fileName ?? "image.png";
                const uploadResult = await uploadMediaToOAPI({
                  account,
                  media: media.buffer,
                  fileName,
                  tokenManager,
                  logger: log,
                });

                if (uploadResult.ok && uploadResult.mediaId) {
                  log?.info?.({ mediaId: uploadResult.mediaId }, "Media uploaded (OAPI), sending image");
                  const sentImage = await sendImageWithMediaIdViaSessionWebhook(
                    chat.sessionWebhook,
                    uploadResult.mediaId,
                    { logger: log }
                  );
                  if (sentImage.ok) {
                    markDelivered("image_local");
                  }
                } else {
                  log?.error?.({ err: uploadResult.error?.message }, "Failed to upload image via OAPI");
                }
              } else {
                // For non-image media, upload via robot API and send as a file message.
                const fileName = media.fileName ?? "file.bin";
                const uploadResult = await uploadMedia({
                  account,
                  file: media.buffer,
                  fileName,
                  tokenManager,
                  logger: log,
                });

                if (uploadResult.ok && uploadResult.mediaId) {
                  const to = isGroup ? chat.conversationId : chat.senderId;
                  if (!to) {
                    log?.error?.({ fileName }, "Missing target for file message delivery");
                  } else {
                    log?.info?.({ mediaId: uploadResult.mediaId, fileName }, "Media uploaded, sending file message");
                    const fileResult = await sendFileMessage({
                      account,
                      to,
                      mediaId: uploadResult.mediaId,
                      fileName,
                      tokenManager,
                      logger: log,
                    });
                    if (fileResult.ok) {
                      markDelivered("file_local");
                    }
                  }
                } else {
                  log?.error?.({ err: uploadResult.error?.message }, "Failed to upload media to DingTalk");
                }
              }
            } catch (err) {
              log?.error?.({ err: { message: (err as Error)?.message }, mediaUrl: mediaUrl.slice(0, 50) }, "Failed to load/upload local media");
            }
          }
        }

        // If the "text" is actually a standalone local path, treat it as media-only.
        const text =
          skipText || (derivedMediaUrl && derivedMediaUrl === inferMediaUrlFromStandaloneText(trimmedText ?? ""))
            ? undefined
            : payload.text;
        if (!text?.trim()) {
          // If we sent an image but no text, that's still a valid delivery
          if (mediaUrl) {
            log?.debug?.({}, "deliver: image sent, no text");
            return;
          }
          log?.info?.({}, "deliver: empty text and no media, skipping");
          return;
        }

        // Check if text is only directive tags (no actual content)
        if (isOnlyDirectiveTags(text)) {
          log?.warn?.({ originalText: text.slice(0, 100), kind: info.kind }, "Filtering directive-only text (no actual content in AI response)");
          return;
        }

        // Strip directive tags like [[reply_to_current]], [[audio_as_voice]] etc.
        let processedText = stripDirectiveTags(text);
        if (!processedText) {
          log?.debug?.({ original: text.slice(0, 30) }, "Empty after stripping directives");
          return;
        }

        if (isReasoningPayload(processedText)) {
          processedText = softenReasoningMarkdown(processedText);
        }

        // ==== Media Protocol Processing ====
        // 1. Process Images: Upload and replace with Markdown syntax (![alt](mediaId))
        // This is required because sessionWebhook does not support independent 'image' msgtype
        const tokenManager = getOrCreateTokenManager(account);

        // Log the text we're checking for media tags
        log?.info?.({
          textSample: processedText.slice(0, 200),
          hasTagPattern: /\[DING:/i.test(processedText)
        }, "Checking for media protocol tags");

        // Helper for uploading media
        const uploadOptions = {
          account,
          sessionWebhook: chat.sessionWebhook,
          tokenManager,
          logger: log,
        };

        if (hasMediaTags(processedText)) {
          log?.info?.("Media tags detected, processing images for markdown embedding...");

          // Replace [DING:IMAGE ...] with ![image](mediaId)
          processedText = await replaceMediaTags(processedText, async (item) => {
            if (item.type === "image") {
              log?.debug?.({ path: item.path }, "Uploading image for embedding");
              const result = await uploadMediaItem(item, uploadOptions);

              if (result.ok && result.mediaId) {
                return `![${item.name || "Image"}](${result.mediaId})`;
              } else {
                log?.warn?.({ path: item.path, error: result.error }, "Failed to embed image");
                return `[图片上传失败: ${item.name || "Image"}]`;
              }
            }
            // Keep other tags (File/Video) for separate processing
            return null;
          });
        }

        // 2. Process Remaining Media (File, Video, Audio)
        // These will be extracted and sent as separate messages
        let mediaItems: { type: "image" | "file" | "video" | "audio"; path: string; name?: string }[] = [];
        if (hasMediaTags(processedText)) {
          log?.info?.("Processing remaining media tags (File/Video/Audio)...");
          const parsed = parseMediaProtocol(processedText);
          processedText = parsed.cleanedContent;
          mediaItems = parsed.items;

          log?.info?.(
            {
              mediaCount: mediaItems.length,
              types: mediaItems.map(i => i.type).join(","),
              paths: mediaItems.map(i => i.path).join(", ")
            },
            "Extracted remaining media items"
          );
        } else {
          log?.debug?.({}, "No remaining media tags found");
        }
        // Apply response prefix to first message only
        const shouldApplyPrefix = firstReply && account.responsePrefix && !prefixApplied.has(sessionKey);
        if (shouldApplyPrefix) {
          processedText = applyResponsePrefix({
            originalText: text,
            cleanedText: processedText,
            responsePrefix: account.responsePrefix,
            context: {
              model: undefined, // Will be filled from agent response
              provider: undefined,
            },
            applyPrefix: true,
          });
          prefixApplied.add(sessionKey);
        }
        firstReply = false;

        // Convert markdown tables and normalize markdown line breaks for DingTalk rendering.
        if (account.replyMode === "markdown") {
          processedText = convertMarkdownForDingTalk(processedText, {
            tableMode: account.tableMode,
          });
        }

        // Send the text reply first (if there's any text content)
        if (processedText.trim()) {
          const textReplyResult = await sendReplyViaSessionWebhook(chat.sessionWebhook, processedText, {
            replyMode: account.replyMode,
            maxChars: account.maxChars,
            tableMode: account.tableMode,
            logger: log,
          });
          if (textReplyResult.ok) {
            markDelivered("text_reply");
            if (info.kind === "final") {
              blockTextBufferState.finalTextDelivered = true;
            }
          } else {
            // If DingTalk rejects a payload (common for markdown edge cases), retry once as plain text.
            // This avoids the confusing situation where Openclaw shows a final answer but DingTalk receives nothing.
            if (account.replyMode === "markdown") {
              log?.warn?.(
                {
                  sessionKey,
                  kind: info.kind,
                  reason: textReplyResult.reason,
                  status: textReplyResult.status,
                },
                "Markdown reply failed; retrying as text"
              );
              const fallbackReply = await sendReplyViaSessionWebhook(chat.sessionWebhook, processedText, {
                replyMode: "text",
                maxChars: account.maxChars,
                logger: log,
              });
              if (fallbackReply.ok) {
                markDelivered("text_reply_fallback_text");
                if (info.kind === "final") {
                  blockTextBufferState.finalTextDelivered = true;
                }
              } else if (info.kind === "final") {
                // Best-effort: notify user that delivery failed.
                await sendReplyViaSessionWebhook(
                  chat.sessionWebhook,
                  "⚠️ 本次回复发送失败（可能触发钉钉格式/频控限制或网络错误）。请稍后重试。",
                  { replyMode: "text", maxChars: account.maxChars, logger: log }
                );
              }
            } else if (info.kind === "final") {
              // Best-effort: notify user that delivery failed.
              await sendReplyViaSessionWebhook(
                chat.sessionWebhook,
                "⚠️ 本次回复发送失败（可能触发钉钉限制或网络错误）。请稍后重试。",
                { replyMode: "text", maxChars: account.maxChars, logger: log }
              );
            }
          }
        }

        // ==== Send Media Items ====
        // After sending text, send each media item as a separate message
        if (mediaItems.length > 0) {
          const tokenManager = getOrCreateTokenManager(account);
          const mediaResult = await processMediaItems(mediaItems, {
            account,
            sessionWebhook: chat.sessionWebhook,
            tokenManager,
            logger: log,
          });

          if (mediaResult.failureCount > 0) {
            // Notify user of failed media
            const errorMsg = `⚠️ ${mediaResult.failureCount} 个媒体发送失败:\n${mediaResult.errors.join("\n")}`;
            const errorReplyResult = await sendReplyViaSessionWebhook(chat.sessionWebhook, errorMsg, {
              replyMode: "text",
              maxChars: account.maxChars,
              logger: log,
            });
            if (errorReplyResult.ok) {
              markDelivered("media_error_notice");
            }
          }
          if (mediaResult.successCount > 0) {
            markDelivered("media_items");
          }

          log?.info?.(
            { success: mediaResult.successCount, failed: mediaResult.failureCount },
            "Media items processing complete"
          );
        }
      },
      onError: (err: unknown, info: { kind: string }) => {
        log?.error?.({ err: { message: (err as Error)?.message }, kind: info.kind }, "Dispatcher delivery error");
      },
    };

    const silentDispatcherOptions = {
      deliver: async () => { },
      onError: (err: unknown, info: { kind: string }) => {
        log?.error?.({ err: { message: (err as Error)?.message }, kind: info.kind }, "Silent dispatcher error");
      },
    };

    const makeCommandCtx = (command: string, suffix: string) => ({
      ...ctx,
      Body: command,
      RawBody: command,
      CommandBody: command,
      BodyForCommands: command,
      BodyForAgent: senderContext + command,
      MessageSid: `${chat.messageId}:${suffix}`,
      CommandAuthorized: true,
    });

    // Dispatch to Clawdbot agent.
    // Always serialize by sessionKey so multiple inbound DingTalk messages don't overlap.
    // Otherwise Openclaw may drop the 2nd run (already-active), and we'd send an incorrect "silent fallback".
    try {
      await enqueueSessionTask(sessionKey, async () => {
        // Set runStartedAt when we actually begin processing (after any queue wait),
        // so transcript-based fallback doesn't accidentally capture prior runs.
        runStartedAt = Date.now();

        if (hasOnceThink) {
          const desired = onceThink.thinkLevel as ThinkLevel;
          const prev = thinkingLevels.get(sessionKey);
          const restore = prev ?? "off";

          try {
            await dispatchReply({
              ctx: makeCommandCtx(`/think ${desired}`, "think-once-set"),
              dispatcherOptions: silentDispatcherOptions,
            });
          } catch (err) {
            log?.warn?.({ err: { message: (err as Error)?.message }, sessionKey }, "Failed to set one-shot think level");
          }

          try {
            let dispatchResult: unknown;
            try {
              dispatchResult = await dispatchReply({ ctx, dispatcherOptions });
            } finally {
              await maybeFinalizeLingeringAICardAfterDispatch({
                sessionKey,
                dispatchResult,
                dispatcherOptions,
              });
            }
            await maybeSendBufferedBlockTextFinal(dispatchResult, dispatcherOptions);
            await maybeSendSilentRunFallback();
          } finally {
            try {
              await dispatchReply({
                ctx: makeCommandCtx(`/think ${restore}`, "think-once-restore"),
                dispatcherOptions: silentDispatcherOptions,
              });
            } catch (err) {
              log?.error?.({ err: { message: (err as Error)?.message }, sessionKey }, "Failed to restore think level");
            }
          }
          return;
        }

        let dispatchResult: unknown;
        try {
          dispatchResult = await dispatchReply({ ctx, dispatcherOptions });
        } finally {
          await maybeFinalizeLingeringAICardAfterDispatch({
            sessionKey,
            dispatchResult,
            dispatcherOptions,
          });
        }
        await maybeSendBufferedBlockTextFinal(dispatchResult, dispatcherOptions);
        await maybeSendSilentRunFallback();
      });
    } catch (err) {
      log?.error?.({ err: { message: (err as Error)?.message } }, "Agent dispatch error");
      // Send error message to user
      await sendReplyViaSessionWebhook(
        chat.sessionWebhook,
        "抱歉，处理您的消息时出现了错误。请稍后重试。",
        {
          replyMode: account.replyMode,
          maxChars: account.maxChars,
          logger: log,
        }
      );
    }
  }

  async function handleCardCallback(callback: CardCallbackMessage): Promise<void> {
    const senderId = callback.userId ?? "unknown";

    if (account.allowFrom.length > 0 && senderId) {
      if (!account.allowFrom.includes(senderId)) {
        log?.info?.({ senderId }, "Blocked card callback sender (not in allowlist)");
        return;
      }
    }

    const chatType =
      inferChatTypeFromOpenSpaceId(callback.openSpaceId) ??
      (callback.conversationId?.startsWith("cid") ? "group" : "direct");
    const conversationId =
      callback.conversationId ??
      extractConversationIdFromOpenSpaceId(callback.openSpaceId) ??
      callback.openSpaceId ??
      "card";

    const actionId = callback.actionId ?? "callback";
    const cardPayload = {
      cardInstanceId: callback.cardInstanceId,
      cardTemplateId: callback.cardTemplateId,
      openSpaceId: callback.openSpaceId,
      params: callback.params ?? {},
    };
    const text = `/card ${actionId} ${JSON.stringify(cardPayload)}`;

    const chat: ChatbotMessage = {
      messageId: callback.messageId || `card:${Date.now()}`,
      eventType: "CARD_CALLBACK",
      text,
      sessionWebhook: "",
      conversationId,
      chatType,
      senderId,
      senderName: callback.userName ?? "Card",
      raw: callback.raw,
      atUsers: [],
      isInAtList: false,
    };

    await handleInboundMessage(chat, {
      bypassMention: true,
      bypassPrefix: true,
      forceCommandAuthorized: true,
      metadata: {
        dingtalk: {
          cardCallback: callback,
        },
      },
    });
  }

  return client;
}
