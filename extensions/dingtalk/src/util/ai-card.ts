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
    return `dtv1.card//IM_GROUP.${conv}`;
  }
  if (!sender) return undefined;
  return `dtv1.card//IM_ROBOT.${sender}`;
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

  if (card?.openSpace || card?.openSpaceId) {
    return { openSpace: card.openSpace, openSpaceId: card.openSpaceId };
  }

  if (account.aiCard.openSpace) {
    return { openSpace: account.aiCard.openSpace };
  }

  if (chat) {
    const openSpaceId = deriveOpenSpaceIdFromChat(chat);
    const openSpace = deriveOpenSpaceFromChat(chat);
    return { openSpace, openSpaceId };
  }

  return {};
}

export function resolveTemplateId(
  account: ResolvedDingTalkAccount,
  card?: DingTalkAICard
): string | undefined {
  return card?.templateId ?? account.aiCard.templateId;
}
