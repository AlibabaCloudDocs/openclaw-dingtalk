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

export function deriveOpenSpaceIdFromChat(chat: ChatbotMessage): string | undefined {
  const conv = chat.conversationId;
  const sender = chat.senderId;
  if (isGroupChatType(chat.chatType)) {
    if (!conv) return undefined;
    return `dtv1.card//im_group.${conv}`;
  }
  if (!sender) return undefined;
  return `dtv1.card//im_robot.${sender}`;
}

export function deriveOpenSpaceFromChat(chat: ChatbotMessage): Record<string, unknown> | undefined {
  const conv = chat.conversationId;
  const sender = chat.senderId;
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

  const openSpace = card?.openSpace ?? account.aiCard.openSpace;
  const openSpaceId =
    card?.openSpaceId ??
    deriveOpenSpaceIdFromOpenSpace(openSpace) ??
    (chat ? deriveOpenSpaceIdFromChat(chat) : undefined);

  return { openSpace, openSpaceId };
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
  return {
    ...defaults,
    [key]: text,
  };
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
      return `dtv1.card//im_group.${conv}`;
    }
  }
  if (robot && typeof robot === "object") {
    const userId = robot.userId;
    if (userId) {
      return `dtv1.card//im_robot.${userId}`;
    }
  }
  return undefined;
}
