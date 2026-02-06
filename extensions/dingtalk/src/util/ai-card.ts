/**
 * Helpers for DingTalk AI card handling.
 */

import crypto from "node:crypto";
import type { ResolvedDingTalkAccount } from "../accounts.js";
import type { ChatbotMessage } from "../stream/types.js";
import type { DingTalkAICard } from "../types/channel-data.js";

export type ResolvedOpenSpace = {
  openSpace?: Record<string, unknown>;
  openSpaceId?: string;
};

export function generateOutTrackId(prefix: string = "card"): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function isGroupChatType(chatType: string | undefined): boolean {
  const ct = (chatType || "").toLowerCase();
  return /group|chat|2|multi/.test(ct);
}

export function normalizeOpenSpaceId(openSpaceId?: string): string | undefined {
  if (!openSpaceId) return undefined;
  let normalized = openSpaceId.trim();
  normalized = normalized.replace(/^dtv1\.card\/\/im_group\./i, "dtv1.card//IM_GROUP.");
  normalized = normalized.replace(/^dtv1\.card\/\/im_robot\./i, "dtv1.card//IM_ROBOT.");
  return normalized;
}

export function resolveCardUserId(chat: ChatbotMessage): string | undefined {
  // message-parser already normalizes senderId with senderStaffId priority.
  if (chat.senderId) return chat.senderId;

  const rawData = (chat.raw as { data?: unknown } | undefined)?.data;
  if (rawData && typeof rawData === "object") {
    const data = rawData as Record<string, unknown>;
    const senderStaffId = data.senderStaffId;
    if (typeof senderStaffId === "string" && senderStaffId) {
      return senderStaffId;
    }
    const userId = data.userId;
    if (typeof userId === "string" && userId) {
      return userId;
    }
    const senderId = data.senderId;
    if (typeof senderId === "string" && senderId) {
      return senderId;
    }
  }
  return undefined;
}

export function deriveOpenSpaceIdFromChat(chat: ChatbotMessage): string | undefined {
  const conv = chat.conversationId;
  const sender = resolveCardUserId(chat);
  if (isGroupChatType(chat.chatType)) {
    if (!conv) return undefined;
    return `dtv1.card//IM_GROUP.${conv}`;
  }
  if (!sender) return undefined;
  return `dtv1.card//IM_ROBOT.${sender}`;
}

export function deriveOpenSpaceFromChat(chat: ChatbotMessage): Record<string, unknown> | undefined {
  const conv = chat.conversationId;
  const sender = resolveCardUserId(chat);
  if (isGroupChatType(chat.chatType) && conv) {
    return {
      imGroupOpenSpaceModel: {
        openConversationId: conv,
      },
    };
  }
  if (!isGroupChatType(chat.chatType) && sender) {
    return {
      imRobotOpenSpaceModel: {
        userId: sender,
      },
    };
  }
  return undefined;
}

export function resolveOpenSpace(params: {
  account: ResolvedDingTalkAccount;
  card?: DingTalkAICard;
  chat?: ChatbotMessage;
}): ResolvedOpenSpace {
  const { account, card, chat } = params;

  const configuredOpenSpace = card?.openSpace ?? account.aiCard.openSpace;
  const derivedOpenSpace = chat ? deriveOpenSpaceFromChat(chat) : undefined;
  const openSpace = mergeOpenSpace(derivedOpenSpace, configuredOpenSpace);
  const openSpaceId = normalizeOpenSpaceId(
    card?.openSpaceId ??
      deriveOpenSpaceIdFromOpenSpace(openSpace) ??
      (chat ? deriveOpenSpaceIdFromChat(chat) : undefined)
  );

  return { openSpace, openSpaceId };
}

function mergeOpenSpace(
  derived: Record<string, unknown> | undefined,
  configured: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!derived && !configured) return undefined;
  if (!derived) return configured;
  if (!configured) return derived;

  const merged: Record<string, unknown> = {
    ...derived,
    ...configured,
  };

  const mergeNested = (key: string) => {
    const left = (derived as Record<string, unknown>)[key];
    const right = (configured as Record<string, unknown>)[key];
    if (left && typeof left === "object" && right && typeof right === "object") {
      merged[key] = { ...(left as Record<string, unknown>), ...(right as Record<string, unknown>) };
    }
  };

  mergeNested("imGroupOpenSpaceModel");
  mergeNested("imRobotOpenSpaceModel");
  mergeNested("imGroupOpenDeliverModel");
  mergeNested("imRobotOpenDeliverModel");

  return merged;
}

export function resolveTemplateId(
  account: ResolvedDingTalkAccount,
  card?: DingTalkAICard
): string | undefined {
  return card?.templateId ?? account.aiCard.templateId;
}

export function buildCardDataFromText(params: {
  account: ResolvedDingTalkAccount;
  text: string;
}): Record<string, unknown> {
  const { account, text } = params;
  const key = account.aiCard.textParamKey || "text";
  const defaults = account.aiCard.defaultCardData ?? {};
  return ensureCardFinishedStatus({
    ...defaults,
    [key]: text,
  });
}

export function convertJSONValuesToString(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = value;
    } else {
      try {
        result[key] = JSON.stringify(value);
      } catch {
        result[key] = "";
      }
    }
  }
  return result;
}

export function normalizeCardData(cardData: Record<string, unknown>): Record<string, unknown> {
  if (!cardData || typeof cardData !== "object") {
    return { cardParamMap: {} };
  }
  if ("cardParamMap" in cardData) {
    const map = (cardData as Record<string, unknown>).cardParamMap as Record<string, unknown>;
    return { ...cardData, cardParamMap: convertJSONValuesToString(map ?? {}) };
  }
  return { cardParamMap: convertJSONValuesToString(cardData) };
}

export function ensureCardFinishedStatus(cardData: Record<string, unknown>): Record<string, unknown> {
  if (!cardData || typeof cardData !== "object") {
    return cardData;
  }

  if ("cardParamMap" in cardData) {
    const raw = (cardData as Record<string, unknown>).cardParamMap;
    const map = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
    if (map.flowStatus === undefined || map.flowStatus === null || map.flowStatus === "") {
      map.flowStatus = "3";
    }
    return { ...cardData, cardParamMap: map };
  }

  const map = { ...cardData };
  if (map.flowStatus === undefined || map.flowStatus === null || map.flowStatus === "") {
    map.flowStatus = "3";
  }
  return map;
}

export function normalizePrivateData(
  privateData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!privateData || typeof privateData !== "object") return undefined;
  if ("cardParamMap" in privateData) {
    const map = (privateData as Record<string, unknown>).cardParamMap as Record<string, unknown>;
    return { ...privateData, cardParamMap: convertJSONValuesToString(map ?? {}) };
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(privateData)) {
    if (value && typeof value === "object" && "cardParamMap" in (value as Record<string, unknown>)) {
      const raw = value as Record<string, unknown>;
      normalized[key] = {
        ...raw,
        cardParamMap: convertJSONValuesToString((raw.cardParamMap as Record<string, unknown>) ?? {}),
      };
    } else {
      const map = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : { value };
      normalized[key] = { cardParamMap: convertJSONValuesToString(map) };
    }
  }
  return normalized;
}

export function deriveOpenSpaceIdFromOpenSpace(
  openSpace?: Record<string, unknown>
): string | undefined {
  if (!openSpace || typeof openSpace !== "object") return undefined;
  const group = (openSpace as Record<string, any>).imGroupOpenSpaceModel;
  const robot = (openSpace as Record<string, any>).imRobotOpenSpaceModel;
  if (group && typeof group === "object") {
    const conv = group.openConversationId;
    if (conv) {
      return `dtv1.card//IM_GROUP.${conv}`;
    }
  }
  if (robot && typeof robot === "object") {
    const userId = robot.userId;
    if (userId) {
      return `dtv1.card//IM_ROBOT.${userId}`;
    }
  }
  return undefined;
}
