/**
 * DingTalk reply implementation via sessionWebhook.
 */

import { chunkText, chunkMarkdownText, normalizeForTextMessage } from "./chunker.js";
import { convertMarkdownForDingTalk } from "./markdown.js";
import { deriveMarkdownTitle } from "./markdown-title.js";
import type { DingTalkActionCard } from "../types/channel-data.js";

export interface ReplyOptions {
  replyMode?: "text" | "markdown";
  maxChars?: number;
  tableMode?: "code" | "off";
  logger?: ReplyLogger;
}

export interface ReplyResult {
  ok: boolean;
  reason?: string;
  status?: number;
  data?: unknown;
  chunks?: number;
}

export interface ReplyLogger {
  debug?: (obj: Record<string, unknown>, msg?: string) => void;
  warn?: (obj: Record<string, unknown> | string, msg?: string) => void;
  error?: (obj: Record<string, unknown>, msg?: string) => void;
}

type DingTalkWebhookResult = {
  errcode?: number;
  errmsg?: string;
};

/**
 * Mask webhook URL for logging (hide query params).
 */
function maskWebhook(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url).slice(0, 64) + "...";
  }
}

async function readDingTalkWebhookResult(
  resp: unknown
): Promise<{ rawText: string; data: DingTalkWebhookResult | undefined }> {
  const anyResp = resp as Record<string, any>;

  // Prefer resp.text() when available because it works for both JSON and plain text.
  if (typeof anyResp?.text === "function") {
    const rawText = await anyResp.text();
    if (!rawText?.trim()) {
      return { rawText: "", data: undefined };
    }
    try {
      const parsed = JSON.parse(rawText) as DingTalkWebhookResult;
      return { rawText, data: parsed };
    } catch {
      return { rawText, data: undefined };
    }
  }

  // Some tests mock fetch responses with json() only.
  if (typeof anyResp?.json === "function") {
    try {
      const parsed = (await anyResp.json()) as DingTalkWebhookResult;
      return { rawText: JSON.stringify(parsed ?? {}), data: parsed };
    } catch {
      return { rawText: "", data: undefined };
    }
  }

  return { rawText: "", data: undefined };
}

function isDingTalkWebhookOk(data: DingTalkWebhookResult | undefined): boolean {
  if (!data) return true;
  if (data.errcode === undefined) return true;
  return data.errcode === 0;
}

/**
 * Send reply to DingTalk via sessionWebhook.
 * Automatically chunks long messages.
 */
export async function sendReplyViaSessionWebhook(
  sessionWebhook: string,
  text: string,
  options: ReplyOptions = {}
): Promise<ReplyResult> {
  const { replyMode = "text", maxChars = 1800, tableMode = "code", logger } = options;

  if (!sessionWebhook) {
    logger?.warn?.("No sessionWebhook, cannot reply");
    return { ok: false, reason: "missing_sessionWebhook" };
  }

  let processedText = text;
  if (replyMode === "markdown") {
    processedText = convertMarkdownForDingTalk(processedText, { tableMode });
  }

  const cleaned = normalizeForTextMessage(processedText);
  const chunks =
    replyMode === "markdown"
      ? chunkMarkdownText(cleaned, maxChars)
      : chunkText(cleaned, maxChars);

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i];
    const payload =
      replyMode === "markdown"
        ? {
          msgtype: "markdown",
          markdown: {
            // DingTalk iOS push preview often uses the title field.
            title: deriveMarkdownTitle(part),
            text: part,
          },
        }
        : {
          msgtype: "text",
          text: {
            content: part,
          },
        };

    try {
      const resp = await fetch(sessionWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      const parsed = await readDingTalkWebhookResult(resp);

      if (!resp.ok) {
        logger?.error?.(
          { err: { message: `HTTP ${resp.status}`, status: resp.status, data: parsed.rawText }, webhook: maskWebhook(sessionWebhook) },
          "Failed to reply DingTalk"
        );
        return { ok: false, reason: "http_error", status: resp.status, data: parsed.rawText || parsed.data };
      }

      if (!isDingTalkWebhookOk(parsed.data)) {
        logger?.error?.(
          {
            errcode: parsed.data?.errcode,
            errmsg: parsed.data?.errmsg,
            webhook: maskWebhook(sessionWebhook),
          },
          "DingTalk API returned error for text reply"
        );
        return { ok: false, reason: "api_error", status: resp.status, data: parsed.data ?? parsed.rawText };
      }

      logger?.debug?.({ webhook: maskWebhook(sessionWebhook), idx: i + 1, total: chunks.length }, "Replied to DingTalk");
    } catch (err) {
      const error = err as Error;
      logger?.error?.(
        { err: { message: error?.message }, webhook: maskWebhook(sessionWebhook) },
        "Failed to reply DingTalk"
      );
      return { ok: false, reason: "fetch_error" };
    }
  }

  return { ok: true, chunks: chunks.length };
}

/**
 * Send an image reply via sessionWebhook.
 */
export async function sendImageViaSessionWebhook(
  sessionWebhook: string,
  picUrl: string,
  options: { text?: string; logger?: ReplyLogger } = {}
): Promise<ReplyResult> {
  const { text, logger } = options;

  if (!sessionWebhook) {
    logger?.warn?.("No sessionWebhook, cannot reply");
    return { ok: false, reason: "missing_sessionWebhook" };
  }

  // DingTalk sessionWebhook uses "image" msgtype with picURL
  const payload = {
    msgtype: "image",
    image: {
      picURL: picUrl,
    },
  };

  try {
    const resp = await fetch(sessionWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const parsed = await readDingTalkWebhookResult(resp);

    if (!resp.ok) {
      logger?.error?.(
        { err: { message: `HTTP ${resp.status}`, status: resp.status, data: parsed.rawText }, webhook: maskWebhook(sessionWebhook) },
        "Failed to send image to DingTalk"
      );
      return { ok: false, reason: "http_error", status: resp.status, data: parsed.rawText || parsed.data };
    }

    if (!isDingTalkWebhookOk(parsed.data)) {
      logger?.error?.(
        { errcode: parsed.data?.errcode, errmsg: parsed.data?.errmsg, webhook: maskWebhook(sessionWebhook) },
        "DingTalk API returned error for image send"
      );
      return { ok: false, reason: "api_error", status: resp.status, data: parsed.data ?? parsed.rawText };
    }

    logger?.debug?.({ webhook: maskWebhook(sessionWebhook), picUrl }, "Sent image to DingTalk");

    // If there's accompanying text, send it after the image
    if (text?.trim()) {
      await sendReplyViaSessionWebhook(sessionWebhook, text, { logger });
    }

    return { ok: true };
  } catch (err) {
    const error = err as Error;
    logger?.error?.(
      { err: { message: error?.message }, webhook: maskWebhook(sessionWebhook) },
      "Failed to send image to DingTalk"
    );
    return { ok: false, reason: "fetch_error" };
  }
}

/**
 * Send an image reply via sessionWebhook using mediaId.
 * Use this when you have uploaded a file and have a mediaId.
 */
export async function sendImageWithMediaIdViaSessionWebhook(
  sessionWebhook: string,
  mediaId: string,
  options: { text?: string; logger?: ReplyLogger } = {}
): Promise<ReplyResult> {
  const { text, logger } = options;

  if (!sessionWebhook) {
    logger?.warn?.("No sessionWebhook, cannot reply");
    return { ok: false, reason: "missing_sessionWebhook" };
  }

  // DingTalk sessionWebhook uses "image" msgtype with media_id
  const payload = {
    msgtype: "image",
    image: {
      media_id: mediaId,
    },
  };

  try {
    const resp = await fetch(sessionWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const parsed = await readDingTalkWebhookResult(resp);

    if (!resp.ok) {
      logger?.error?.(
        { err: { message: `HTTP ${resp.status}`, status: resp.status, data: parsed.rawText.slice(0, 500) }, webhook: maskWebhook(sessionWebhook) },
        "Failed to send image (mediaId) to DingTalk"
      );
      return { ok: false, reason: "http_error", status: resp.status, data: parsed.rawText || parsed.data };
    }

    // Check DingTalk API-level error (HTTP 200 but errcode != 0)
    if (!isDingTalkWebhookOk(parsed.data)) {
      logger?.error?.(
        { errcode: parsed.data?.errcode, errmsg: parsed.data?.errmsg, webhook: maskWebhook(sessionWebhook), mediaId },
        "DingTalk API returned error for image send"
      );
      return { ok: false, reason: "api_error", status: resp.status, data: parsed.data ?? parsed.rawText };
    }

    logger?.debug?.({ webhook: maskWebhook(sessionWebhook), mediaId, response: parsed.rawText.slice(0, 200) }, "Sent image (mediaId) to DingTalk");

    // If there's accompanying text, send it after the image
    if (text?.trim()) {
      await sendReplyViaSessionWebhook(sessionWebhook, text, { logger });
    }

    return { ok: true };
  } catch (err) {
    const error = err as Error;
    logger?.error?.(
      { err: { message: error?.message }, webhook: maskWebhook(sessionWebhook) },
      "Failed to send image (mediaId) to DingTalk"
    );
    return { ok: false, reason: "fetch_error" };
  }
}

/**
 * Send an ActionCard reply via sessionWebhook.
 */
export async function sendActionCardViaSessionWebhook(
  sessionWebhook: string,
  actionCard: DingTalkActionCard,
  options: { logger?: ReplyLogger } = {}
): Promise<ReplyResult> {
  const { logger } = options;

  if (!sessionWebhook) {
    logger?.warn?.("No sessionWebhook, cannot reply");
    return { ok: false, reason: "missing_sessionWebhook" };
  }

  // Build ActionCard payload for sessionWebhook
  // DingTalk sessionWebhook uses different format than proactive API
  let payload: Record<string, unknown>;

  if (actionCard.buttons && actionCard.buttons.length >= 2) {
    // Multi-button ActionCard
    payload = {
      msgtype: "actionCard",
      actionCard: {
        title: actionCard.title,
        text: actionCard.text,
        btnOrientation: actionCard.btnOrientation ?? "0",
        btns: actionCard.buttons.map((btn) => ({
          title: btn.title,
          actionURL: btn.actionURL,
        })),
      },
    };
  } else {
    // Single-button ActionCard
    payload = {
      msgtype: "actionCard",
      actionCard: {
        title: actionCard.title,
        text: actionCard.text,
        singleTitle: actionCard.singleTitle ?? "查看详情",
        singleURL: actionCard.singleURL ?? "",
      },
    };
  }

  try {
    const resp = await fetch(sessionWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const parsed = await readDingTalkWebhookResult(resp);

    if (!resp.ok) {
      logger?.error?.(
        { err: { message: `HTTP ${resp.status}`, status: resp.status, data: parsed.rawText }, webhook: maskWebhook(sessionWebhook) },
        "Failed to send ActionCard to DingTalk"
      );
      return { ok: false, reason: "http_error", status: resp.status, data: parsed.rawText || parsed.data };
    }

    if (!isDingTalkWebhookOk(parsed.data)) {
      logger?.error?.(
        { errcode: parsed.data?.errcode, errmsg: parsed.data?.errmsg, webhook: maskWebhook(sessionWebhook) },
        "DingTalk API returned error for ActionCard send"
      );
      return { ok: false, reason: "api_error", status: resp.status, data: parsed.data ?? parsed.rawText };
    }

    logger?.debug?.({ webhook: maskWebhook(sessionWebhook), title: actionCard.title }, "Sent ActionCard to DingTalk");

    return { ok: true };
  } catch (err) {
    const error = err as Error;
    logger?.error?.(
      { err: { message: error?.message }, webhook: maskWebhook(sessionWebhook) },
      "Failed to send ActionCard to DingTalk"
    );
    return { ok: false, reason: "fetch_error" };
  }
}

/**
 * Response prefix template variable pattern.
 */
const TEMPLATE_VAR_PATTERN = /\{([a-zA-Z][a-zA-Z0-9.]*)\}/g;

/**
 * Resolve response prefix template with model context.
 */
export function resolveResponsePrefix(
  template: string | undefined,
  context: { model?: string; provider?: string; identity?: string }
): string | undefined {
  if (template === undefined || template === null) return undefined;

  return template.replace(TEMPLATE_VAR_PATTERN, (match, varName: string) => {
    const normalized = varName.toLowerCase();
    switch (normalized) {
      case "model":
        return context.model ?? match;
      case "provider":
        return context.provider ?? match;
      case "identity":
        return context.identity ?? match;
      default:
        return match;
    }
  });
}
