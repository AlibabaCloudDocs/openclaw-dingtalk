/**
 * Integration tests for DingTalk probe.
 * These tests require real DingTalk credentials.
 *
 * Set environment variables before running:
 * - DINGTALK_TEST_CLIENT_ID
 * - DINGTALK_TEST_CLIENT_SECRET
 */
import { describe, it, expect, beforeAll } from "vitest";
import { probeDingTalk } from "../../src/probe.js";
import type { ResolvedDingTalkAccount } from "../../src/accounts.js";

const hasCredentials = Boolean(
  process.env.DINGTALK_TEST_CLIENT_ID && process.env.DINGTALK_TEST_CLIENT_SECRET
);

describe.skipIf(!hasCredentials)("probeDingTalk integration", () => {
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
    };
  });

  it("successfully probes DingTalk API with valid credentials", async () => {
    const result = await probeDingTalk(testAccount);

    expect(result.ok).toBe(true);
    expect(result.elapsedMs).toBeDefined();
    expect(result.elapsedMs).toBeGreaterThan(0);
    console.log(`Probe successful in ${result.elapsedMs}ms`);
  });

  it("returns error for invalid credentials", async () => {
    const invalidAccount = {
      ...testAccount,
      clientSecret: "invalid-secret",
    };

    const result = await probeDingTalk(invalidAccount);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    console.log(`Expected error: ${result.error}`);
  });

  it("respects timeout parameter", async () => {
    const result = await probeDingTalk(testAccount, 10000);

    expect(result.ok).toBe(true);
    expect(result.elapsedMs).toBeLessThan(10000);
  });
});

describe("probeDingTalk integration (always run)", () => {
  it("skipped when no credentials", () => {
    if (!hasCredentials) {
      console.log(
        "Integration tests skipped: Set DINGTALK_TEST_CLIENT_ID and DINGTALK_TEST_CLIENT_SECRET"
      );
    }
    expect(true).toBe(true);
  });
});
