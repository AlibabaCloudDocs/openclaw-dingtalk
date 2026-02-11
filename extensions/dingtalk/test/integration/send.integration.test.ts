/**
 * Integration tests for DingTalk message sending.
 * These tests require real DingTalk credentials and a test user/group.
 *
 * Set environment variables before running:
 * - DINGTALK_TEST_CLIENT_ID
 * - DINGTALK_TEST_CLIENT_SECRET
 * - DINGTALK_TEST_USER_ID (optional: for DM tests)
 * - DINGTALK_TEST_CONVERSATION_ID (optional: for group tests)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { sendProactiveMessage } from "../../src/api/send-message.js";
import type { ResolvedDingTalkAccount } from "../../src/accounts.js";

const hasCredentials = Boolean(
  process.env.DINGTALK_TEST_CLIENT_ID && process.env.DINGTALK_TEST_CLIENT_SECRET
);
const hasTestUser = Boolean(process.env.DINGTALK_TEST_USER_ID);
const hasTestGroup = Boolean(process.env.DINGTALK_TEST_CONVERSATION_ID);

describe.skipIf(!hasCredentials)("sendProactiveMessage integration", () => {
  let testAccount: ResolvedDingTalkAccount;

  beforeAll(() => {
    testAccount = {
      accountId: "test",
      enabled: true,
      clientId: process.env.DINGTALK_TEST_CLIENT_ID!,
      clientSecret: process.env.DINGTALK_TEST_CLIENT_SECRET!,
      credentialSource: "env",
      apiBase: "https://api.dingtalk.com",
      openPath: "/v1.0/gateway/connections/open",
      replyMode: "text",
      maxChars: 1800,
      tableMode: "code",
      coalesce: {
        enabled: false,
        minChars: 100,
        maxChars: 1000,
        idleMs: 500,
      },
      allowFrom: [],
      showToolStatus: false,
      showToolResult: false,
      thinking: "off",
      rateLimit: {
        enabled: true,
        windowSeconds: 60,
        maxRequests: 8,
        burst: 3,
        bypassUsers: [],
        replyOnLimit: true,
        limitMessage: "请求太频繁，请稍后再试。",
      },
    };
  });

  describe.skipIf(!hasTestUser)("Direct message tests", () => {
    it("sends text message to user", async () => {
      const result = await sendProactiveMessage({
        account: testAccount,
        to: `user:${process.env.DINGTALK_TEST_USER_ID}`,
        text: `Integration test message at ${new Date().toISOString()}`,
        replyMode: "text",
      });

      expect(result.ok).toBe(true);
      expect(result.processQueryKey).toBeDefined();
      console.log(`Message sent, queryKey: ${result.processQueryKey}`);
    });

    it("sends markdown message to user", async () => {
      const result = await sendProactiveMessage({
        account: testAccount,
        to: `user:${process.env.DINGTALK_TEST_USER_ID}`,
        text: `# Integration Test\n\nMarkdown message at ${new Date().toISOString()}`,
        replyMode: "markdown",
      });

      expect(result.ok).toBe(true);
      console.log(`Markdown sent, queryKey: ${result.processQueryKey}`);
    });
  });

  describe.skipIf(!hasTestGroup)("Group message tests", () => {
    it("sends text message to group", async () => {
      const result = await sendProactiveMessage({
        account: testAccount,
        to: `group:${process.env.DINGTALK_TEST_CONVERSATION_ID}`,
        text: `Integration test group message at ${new Date().toISOString()}`,
        replyMode: "text",
      });

      expect(result.ok).toBe(true);
      console.log(`Group message sent, queryKey: ${result.processQueryKey}`);
    });
  });

  it("returns error for non-existent user", async () => {
    const result = await sendProactiveMessage({
      account: testAccount,
      to: "user:non_existent_user_id_12345",
      text: "This should fail",
    });

    // DingTalk may return ok but with invalidUserIds
    if (result.ok) {
      expect(result.invalidUserIds?.length).toBeGreaterThan(0);
    } else {
      expect(result.error).toBeDefined();
    }
  });
});

describe("sendProactiveMessage integration (always run)", () => {
  it("skipped when no credentials", () => {
    if (!hasCredentials) {
      console.log("Integration tests skipped: Set DINGTALK_TEST_* environment variables");
    }
    if (hasCredentials && !hasTestUser && !hasTestGroup) {
      console.log(
        "Note: Set DINGTALK_TEST_USER_ID or DINGTALK_TEST_CONVERSATION_ID for full tests"
      );
    }
    expect(true).toBe(true);
  });
});
