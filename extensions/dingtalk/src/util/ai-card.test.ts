import { describe, expect, it } from "vitest";
import type { ChatbotMessage } from "../stream/types.js";
import { BASIC_ACCOUNT } from "../../test/fixtures/configs.js";
import {
  buildCardDataFromText,
  deriveOpenSpaceIdFromChat,
  ensureCardFinishedStatus,
  normalizeOpenSpaceId,
  resolveCardUserId,
} from "./ai-card.js";

function createChat(overrides: Partial<ChatbotMessage> = {}): ChatbotMessage {
  return {
    messageId: "msg-1",
    eventType: "CALLBACK",
    text: "hello",
    sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=test",
    conversationId: "cid123",
    chatType: "1",
    senderId: "staff-001",
    senderName: "Test",
    raw: {
      type: "CALLBACK",
      headers: { topic: "/v1.0/im/bot/messages/get", messageId: "msg-1" },
      data: {
        senderStaffId: "staff-001",
        senderId: "$:LWCP_v1:$raw",
      },
    },
    atUsers: [],
    isInAtList: true,
    ...overrides,
  };
}

describe("ai-card util", () => {
  it("normalizes openSpaceId prefix to IM_GROUP/IM_ROBOT", () => {
    expect(normalizeOpenSpaceId("dtv1.card//im_group.cid123")).toBe("dtv1.card//IM_GROUP.cid123");
    expect(normalizeOpenSpaceId("dtv1.card//im_robot.user001")).toBe("dtv1.card//IM_ROBOT.user001");
    expect(normalizeOpenSpaceId("dtv1.card//IM_ROBOT.user001")).toBe("dtv1.card//IM_ROBOT.user001");
  });

  it("uses normalized senderId first when resolving card user id", () => {
    const chat = createChat();
    expect(resolveCardUserId(chat)).toBe("staff-001");
  });

  it("derives IM_ROBOT/IM_GROUP openSpaceId from chat", () => {
    const directChat = createChat({ chatType: "1", senderId: "staff-001" });
    expect(deriveOpenSpaceIdFromChat(directChat)).toBe("dtv1.card//IM_ROBOT.staff-001");

    const groupChat = createChat({ chatType: "2", conversationId: "cid-group-001" });
    expect(deriveOpenSpaceIdFromChat(groupChat)).toBe("dtv1.card//IM_GROUP.cid-group-001");
  });

  it("adds flowStatus=3 when building auto card text data", () => {
    const account = {
      ...BASIC_ACCOUNT,
      aiCard: {
        ...BASIC_ACCOUNT.aiCard,
        textParamKey: "content",
      },
    };
    const data = buildCardDataFromText({ account, text: "hello" });
    expect((data as Record<string, unknown>).content).toBe("hello");
    expect((data as Record<string, unknown>).flowStatus).toBe("3");
  });

  it("keeps existing flowStatus when finishing card data", () => {
    const data = ensureCardFinishedStatus({
      cardParamMap: {
        flowStatus: "2",
        content: "hello",
      },
    }) as Record<string, unknown>;
    const map = data.cardParamMap as Record<string, unknown>;
    expect(map.flowStatus).toBe("2");
  });
});
