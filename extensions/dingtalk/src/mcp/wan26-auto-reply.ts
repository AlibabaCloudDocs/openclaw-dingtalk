import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveDingTalkAccount, isDingTalkAccountConfigured } from "../accounts.js";
import { sendMediaByPath } from "../api/send-message.js";
import { DINGTALK_CHANNEL_ID } from "../config-schema.js";
import { resolveDingTalkTargetFromSessionKey } from "./session-target.js";

const URL_PATTERN = /(https?:\/\/[^\s"'`<>)\]}]+)/gi;
const MEDIA_EXT_PATTERN = /\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|mov|mkv|webm|avi|m4v)(\?.*)?$/i;
const MEDIA_KEYWORDS = [
  "image",
  "video",
  "media",
  "file",
  "url",
  "output",
  "download",
  "result",
];

type VisitContext = {
  parentKey?: string;
};

export type Wan26AutoSendResult = {
  attempted: number;
  sent: number;
  skippedReason?: string;
  target?: string;
  mediaUrls: string[];
  errors: string[];
};

function isLikelyMediaKey(key?: string): boolean {
  if (!key) {
    return false;
  }
  const normalized = key.trim().toLowerCase();
  return MEDIA_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function extractHttpUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  if (!matches) {
    return [];
  }
  return matches.map((entry) => entry.trim()).filter(Boolean);
}

function shouldKeepUrl(url: string, keyHint?: string): boolean {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  if (MEDIA_EXT_PATTERN.test(url)) {
    return true;
  }
  return isLikelyMediaKey(keyHint);
}

function collectMediaUrls(value: unknown, out: Set<string>, ctx: VisitContext = {}): void {
  if (typeof value === "string") {
    const urls = extractHttpUrls(value);
    for (const url of urls) {
      if (shouldKeepUrl(url, ctx.parentKey)) {
        out.add(url);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMediaUrls(item, out, ctx);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectMediaUrls(child, out, { parentKey: key });
  }
}

export function extractWan26MediaUrls(payload: unknown): string[] {
  const urls = new Set<string>();
  collectMediaUrls(payload, urls);
  return Array.from(urls);
}

function isDingTalkMessageChannel(channel?: string): boolean {
  const normalized = (channel ?? "").trim().toLowerCase();
  return normalized === DINGTALK_CHANNEL_ID || normalized === "dingtalk";
}

export async function autoSendWan26MediaToDingtalk(params: {
  payload: unknown;
  config?: OpenClawConfig;
  messageChannel?: string;
  sessionKey?: string;
  agentAccountId?: string;
}): Promise<Wan26AutoSendResult> {
  const mediaUrls = extractWan26MediaUrls(params.payload).slice(0, 5);
  if (mediaUrls.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: "no_media_url_found",
      mediaUrls: [],
      errors: [],
    };
  }

  if (!isDingTalkMessageChannel(params.messageChannel)) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: "not_dingtalk_channel",
      mediaUrls,
      errors: [],
    };
  }

  if (!params.config) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: "missing_gateway_config",
      mediaUrls,
      errors: [],
    };
  }

  const target = resolveDingTalkTargetFromSessionKey(params.sessionKey);
  if (!target) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: "missing_dingtalk_session_target",
      mediaUrls,
      errors: [],
    };
  }

  const account = resolveDingTalkAccount({
    cfg: params.config,
    accountId: params.agentAccountId ?? undefined,
  });
  if (!isDingTalkAccountConfigured(account)) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: "dingtalk_account_not_configured",
      mediaUrls,
      target,
      errors: [],
    };
  }

  let sent = 0;
  const errors: string[] = [];
  for (const mediaUrl of mediaUrls) {
    const result = await sendMediaByPath({
      account,
      to: target,
      mediaUrl,
      text: "",
    });
    if (result.ok) {
      sent += 1;
    } else {
      errors.push(result.error?.message || "send_media_failed");
    }
  }

  return {
    attempted: mediaUrls.length,
    sent,
    target,
    mediaUrls,
    errors,
  };
}

