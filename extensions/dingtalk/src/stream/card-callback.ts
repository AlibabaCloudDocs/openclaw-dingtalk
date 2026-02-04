/**
 * DingTalk AI Card callback parsing.
 * Handles callback payload differences across versions.
 */

import type { RawStreamMessage, CardCallbackMessage } from "./types.js";

function get(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function first(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return "";
  return String(v);
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

export function extractCardCallback(raw: RawStreamMessage): CardCallbackMessage | null {
  const headers = raw?.headers ?? raw?.header ?? raw?.meta ?? {};
  let data: unknown = raw?.data ?? raw?.payload ?? raw?.body ?? raw?.event ?? raw?.content ?? raw;

  if (typeof data === "string" && data.startsWith("{")) {
    try {
      data = JSON.parse(data);
    } catch {
      // ignore parse errors
    }
  }

  const messageId = asString(
    first(raw, [
      "headers.messageId",
      "headers.message_id",
      "header.messageId",
      "header.message_id",
      "messageId",
      "message_id",
      "id",
      "uuid",
    ])
  );

  const cardInstanceId = asString(
    first(data, [
      "cardInstanceId",
      "card_instance_id",
      "cardInstanceID",
      "instanceId",
      "card.instanceId",
    ])
  );

  const cardTemplateId = asString(
    first(data, [
      "cardTemplateId",
      "card_template_id",
      "templateId",
      "template_id",
    ])
  );

  const actionId = asString(
    first(data, [
      "actionId",
      "action_id",
      "actionKey",
      "action_key",
      "callback.actionId",
      "callback.action_id",
    ])
  );

  const params =
    asRecord(
      first(data, [
        "actionParams",
        "action_params",
        "params",
        "callback.params",
        "cardPrivateData",
      ])
    ) ?? undefined;

  const userId = asString(
    first(data, [
      "userId",
      "user_id",
      "operator.userId",
      "operator.userid",
      "senderStaffId",
    ])
  );

  const userName = asString(
    first(data, [
      "userName",
      "user_name",
      "operator.name",
      "operator.nick",
      "senderNick",
    ])
  );

  const openSpaceId = asString(
    first(data, [
      "openSpaceId",
      "open_space_id",
      "spaceId",
      "space_id",
    ])
  );

  const conversationId = asString(
    first(data, [
      "conversationId",
      "conversation_id",
      "openConversationId",
      "open_conversation_id",
      "context.conversationId",
    ])
  );

  const looksLikeCard =
    Boolean(cardInstanceId) ||
    /card/.test(asString(first(headers, ["topic", "eventType", "type"])));

  if (!looksLikeCard) return null;

  return {
    messageId,
    cardInstanceId: cardInstanceId || undefined,
    cardTemplateId: cardTemplateId || undefined,
    actionId: actionId || undefined,
    params,
    userId: userId || undefined,
    userName: userName || undefined,
    openSpaceId: openSpaceId || undefined,
    conversationId: conversationId || undefined,
    raw,
  };
}
