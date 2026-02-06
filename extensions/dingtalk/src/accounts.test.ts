/**
 * Tests for DingTalk account resolution.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveDingTalkAccount,
  listDingTalkAccountIds,
  resolveDefaultDingTalkAccountId,
  isDingTalkAccountConfigured,
} from "./accounts.js";
import {
  createMockClawdbotConfig,
  createEnvBasedConfig,
  createMultiAccountConfig,
} from "../test/fixtures/configs.js";
import { DINGTALK_CHANNEL_ID } from "./config-schema.js";

describe("resolveDingTalkAccount", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves basic account from config", () => {
    const cfg = createMockClawdbotConfig();
    const account = resolveDingTalkAccount({ cfg });

    expect(account.accountId).toBe("default");
    expect(account.clientId).toBe("test-client-id");
    expect(account.clientSecret).toBe("test-client-secret");
    expect(account.credentialSource).toBe("config");
    expect(account.enabled).toBe(true);
  });

  it("resolves grouped config from new Control UI paths", () => {
    const cfg = {
      channels: {
        [DINGTALK_CHANNEL_ID]: {
          enabled: true,
          credentials: {
            name: "Grouped Bot",
            clientId: "grouped-client-id",
            clientSecret: "grouped-client-secret",
            selfUserId: "bot-self-001",
          },
          conversation: {
            allowFrom: ["user-1"],
            requireMention: false,
            requirePrefix: "#",
            mentionBypassUsers: ["admin-1"],
            isolateContextPerUserInGroup: true,
          },
          reply: {
            replyMode: "markdown",
            maxChars: 2400,
            tableMode: "off",
            responsePrefix: "[bot]",
            showToolStatus: true,
            showToolResult: true,
            thinking: "medium",
            coalesce: {
              enabled: true,
              minChars: 600,
              maxChars: 1400,
              idleMs: 700,
            },
          },
          streaming: {
            blockStreaming: false,
            streamBlockTextToSession: true,
          },
          connection: {
            apiBase: "https://api.example.com",
            openPath: "/gateway/open",
            subscriptionsJson: "{\"type\":\"test\"}",
          },
        },
      },
    };

    const account = resolveDingTalkAccount({ cfg });

    expect(account.name).toBe("Grouped Bot");
    expect(account.clientId).toBe("grouped-client-id");
    expect(account.clientSecret).toBe("grouped-client-secret");
    expect(account.selfUserId).toBe("bot-self-001");
    expect(account.allowFrom).toEqual(["user-1"]);
    expect(account.requireMention).toBe(false);
    expect(account.requirePrefix).toBe("#");
    expect(account.mentionBypassUsers).toEqual(["admin-1"]);
    expect(account.isolateContextPerUserInGroup).toBe(true);
    expect(account.replyMode).toBe("markdown");
    expect(account.maxChars).toBe(2400);
    expect(account.tableMode).toBe("off");
    expect(account.responsePrefix).toBe("[bot]");
    expect(account.showToolStatus).toBe(true);
    expect(account.showToolResult).toBe(true);
    expect(account.thinking).toBe("medium");
    expect(account.coalesce).toEqual({
      enabled: true,
      minChars: 600,
      maxChars: 1400,
      idleMs: 700,
    });
    expect(account.blockStreaming).toBe(false);
    expect(account.streamBlockTextToSession).toBe(true);
    expect(account.apiBase).toBe("https://api.example.com");
    expect(account.openPath).toBe("/gateway/open");
    expect(account.subscriptionsJson).toBe("{\"type\":\"test\"}");
  });

  it("prefers grouped config over legacy flat fields when both exist", () => {
    const cfg = {
      channels: {
        [DINGTALK_CHANNEL_ID]: {
          clientId: "legacy-client-id",
          clientSecret: "legacy-client-secret",
          replyMode: "text",
          blockStreaming: true,
          credentials: {
            clientId: "grouped-client-id",
            clientSecret: "grouped-client-secret",
          },
          reply: {
            replyMode: "markdown",
          },
          streaming: {
            blockStreaming: false,
          },
        },
      },
    };

    const account = resolveDingTalkAccount({ cfg });

    expect(account.clientId).toBe("grouped-client-id");
    expect(account.clientSecret).toBe("grouped-client-secret");
    expect(account.replyMode).toBe("markdown");
    expect(account.blockStreaming).toBe(false);
  });

  it("resolves account from environment variables", () => {
    process.env.DINGTALK_CLIENT_ID = "env-client-id";
    process.env.DINGTALK_CLIENT_SECRET = "env-client-secret";

    const cfg = createEnvBasedConfig();
    const account = resolveDingTalkAccount({ cfg });

    expect(account.clientId).toBe("env-client-id");
    expect(account.clientSecret).toBe("env-client-secret");
    expect(account.credentialSource).toBe("env");
  });

  it("resolves named account from multi-account config", () => {
    const cfg = createMultiAccountConfig();
    const account = resolveDingTalkAccount({ cfg, accountId: "team1" });

    expect(account.accountId).toBe("team1");
    expect(account.name).toBe("Team 1 Bot");
    expect(account.clientId).toBe("team1-client-id");
    expect(account.clientSecret).toBe("team1-client-secret");
  });

  it("inherits settings from base when account overrides not specified", () => {
    const cfg = createMultiAccountConfig();
    const account = resolveDingTalkAccount({ cfg, accountId: "team1" });

    // Should inherit replyMode from base (default is "text")
    expect(account.replyMode).toBe("text");
  });

  it("uses account-specific overrides when provided", () => {
    const cfg = createMultiAccountConfig();
    const account = resolveDingTalkAccount({ cfg, accountId: "team2" });

    // team2 has its own replyMode
    expect(account.replyMode).toBe("markdown");
  });

  it("supports grouped account-level overrides in multi-account config", () => {
    const cfg = createMultiAccountConfig() as Record<string, any>;
    cfg.channels[DINGTALK_CHANNEL_ID].conversation = { requireMention: true };
    cfg.channels[DINGTALK_CHANNEL_ID].reply = { showToolStatus: false };
    cfg.channels[DINGTALK_CHANNEL_ID].accounts.team1 = {
      ...cfg.channels[DINGTALK_CHANNEL_ID].accounts.team1,
      credentials: {
        clientId: "team1-grouped-client-id",
        clientSecret: "team1-grouped-client-secret",
      },
      conversation: {
        requireMention: false,
      },
      reply: {
        showToolStatus: true,
      },
    };

    const account = resolveDingTalkAccount({ cfg, accountId: "team1" });

    expect(account.clientId).toBe("team1-grouped-client-id");
    expect(account.clientSecret).toBe("team1-grouped-client-secret");
    expect(account.requireMention).toBe(false);
    expect(account.showToolStatus).toBe(true);
  });

  it("applies default values", () => {
    const cfg = createMockClawdbotConfig();
    const account = resolveDingTalkAccount({ cfg });

    expect(account.apiBase).toBe("https://api.dingtalk.com");
    expect(account.openPath).toBe("/v1.0/gateway/connections/open");
    expect(account.replyMode).toBe("text");
    expect(account.maxChars).toBe(1800);
    expect(account.tableMode).toBe("code");
    expect(account.allowFrom).toEqual([]);
    expect(account.showToolStatus).toBe(false);
    expect(account.showToolResult).toBe(false);
    expect(account.blockStreaming).toBe(true);
    expect(account.streamBlockTextToSession).toBe(false);
    expect(account.isolateContextPerUserInGroup).toBe(false);
    expect(account.thinking).toBe("off");
    expect(account.aiCard.enabled).toBe(false);
    expect(account.aiCard.autoReply).toBe(true);
    expect(account.aiCard.callbackType).toBe("STREAM");
    expect(account.aiCard.updateThrottleMs).toBe(800);
  });

  it("resolves isolateContextPerUserInGroup from config", () => {
    const cfg = createMockClawdbotConfig({
      isolateContextPerUserInGroup: true,
    });
    const account = resolveDingTalkAccount({ cfg });

    expect(account.isolateContextPerUserInGroup).toBe(true);
  });

  it("merges coalesce config with defaults", () => {
    const cfg = createMockClawdbotConfig({
      coalesce: {
        enabled: true,
        minChars: 500,
        maxChars: 1500,
        idleMs: 800,
      },
    });
    const account = resolveDingTalkAccount({ cfg });

    expect(account.coalesce.enabled).toBe(true);
    expect(account.coalesce.minChars).toBe(500);
    expect(account.coalesce.maxChars).toBe(1500);
    expect(account.coalesce.idleMs).toBe(800);
  });

  it("resolves allowFrom array", () => {
    const cfg = createMockClawdbotConfig({
      allowFrom: ["user1", "user2", "user3"],
    });
    const account = resolveDingTalkAccount({ cfg });

    expect(account.allowFrom).toEqual(["user1", "user2", "user3"]);
  });

  it("supports disabling blockStreaming at channel level", () => {
    const cfg = createMockClawdbotConfig({
      blockStreaming: false,
    });
    const account = resolveDingTalkAccount({ cfg });

    expect(account.blockStreaming).toBe(false);
  });

  it("lets account-level blockStreaming override base config", () => {
    const cfg = createMultiAccountConfig() as Record<string, any>;
    cfg.channels[DINGTALK_CHANNEL_ID].blockStreaming = true;
    cfg.channels[DINGTALK_CHANNEL_ID].accounts.team2.blockStreaming = false;

    const team1 = resolveDingTalkAccount({ cfg, accountId: "team1" });
    const team2 = resolveDingTalkAccount({ cfg, accountId: "team2" });

    expect(team1.blockStreaming).toBe(true);
    expect(team2.blockStreaming).toBe(false);
  });

  it("supports enabling streamBlockTextToSession at channel level", () => {
    const cfg = createMockClawdbotConfig({
      streamBlockTextToSession: true,
    });
    const account = resolveDingTalkAccount({ cfg });

    expect(account.streamBlockTextToSession).toBe(true);
  });

  it("lets account-level streamBlockTextToSession override base config", () => {
    const cfg = createMultiAccountConfig() as Record<string, any>;
    cfg.channels[DINGTALK_CHANNEL_ID].streamBlockTextToSession = false;
    cfg.channels[DINGTALK_CHANNEL_ID].accounts.team2.streamBlockTextToSession = true;

    const team1 = resolveDingTalkAccount({ cfg, accountId: "team1" });
    const team2 = resolveDingTalkAccount({ cfg, accountId: "team2" });

    expect(team1.streamBlockTextToSession).toBe(false);
    expect(team2.streamBlockTextToSession).toBe(true);
  });

  it("handles missing dingtalk section gracefully", () => {
    const cfg = { channels: {} };
    const account = resolveDingTalkAccount({ cfg });

    expect(account.clientId).toBe("");
    expect(account.clientSecret).toBe("");
    expect(account.credentialSource).toBe("none");
  });

  it("prioritizes config over environment variables", () => {
    process.env.DINGTALK_CLIENT_ID = "env-id";
    process.env.DINGTALK_CLIENT_SECRET = "env-secret";

    const cfg = createMockClawdbotConfig();
    const account = resolveDingTalkAccount({ cfg });

    expect(account.clientId).toBe("test-client-id");
    expect(account.credentialSource).toBe("config");
  });
});

describe("listDingTalkAccountIds", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns default account when base credentials exist", () => {
    const cfg = createMockClawdbotConfig();
    const ids = listDingTalkAccountIds(cfg);

    expect(ids).toContain("default");
  });

  it("returns default account when grouped credentials exist", () => {
    const cfg = {
      channels: {
        [DINGTALK_CHANNEL_ID]: {
          credentials: {
            clientId: "grouped-client-id",
          },
        },
      },
    };
    const ids = listDingTalkAccountIds(cfg);

    expect(ids).toContain("default");
  });

  it("returns all named accounts", () => {
    const cfg = createMultiAccountConfig();
    const ids = listDingTalkAccountIds(cfg);

    expect(ids).toContain("default");
    expect(ids).toContain("team1");
    expect(ids).toContain("team2");
  });

  it("returns empty array when no dingtalk section", () => {
    const cfg = { channels: {} };
    const ids = listDingTalkAccountIds(cfg);

    expect(ids).toEqual([]);
  });

  it("includes default when env credentials exist", () => {
    process.env.DINGTALK_CLIENT_ID = "env-id";

    const cfg = createEnvBasedConfig();
    const ids = listDingTalkAccountIds(cfg);

    expect(ids).toContain("default");
  });
});

describe("resolveDefaultDingTalkAccountId", () => {
  it("returns first account ID when accounts exist", () => {
    const cfg = createMockClawdbotConfig();
    const defaultId = resolveDefaultDingTalkAccountId(cfg);

    expect(defaultId).toBe("default");
  });

  it("returns default when no accounts configured", () => {
    const cfg = { channels: {} };
    const defaultId = resolveDefaultDingTalkAccountId(cfg);

    expect(defaultId).toBe("default");
  });
});

describe("isDingTalkAccountConfigured", () => {
  it("returns true when both clientId and clientSecret are set", () => {
    const account = resolveDingTalkAccount({
      cfg: createMockClawdbotConfig(),
    });

    expect(isDingTalkAccountConfigured(account)).toBe(true);
  });

  it("returns false when clientId is empty", () => {
    const account = {
      ...resolveDingTalkAccount({ cfg: createMockClawdbotConfig() }),
      clientId: "",
    };

    expect(isDingTalkAccountConfigured(account)).toBe(false);
  });

  it("returns false when clientSecret is empty", () => {
    const account = {
      ...resolveDingTalkAccount({ cfg: createMockClawdbotConfig() }),
      clientSecret: "",
    };

    expect(isDingTalkAccountConfigured(account)).toBe(false);
  });

  it("returns false when clientId is whitespace only", () => {
    const account = {
      ...resolveDingTalkAccount({ cfg: createMockClawdbotConfig() }),
      clientId: "   ",
    };

    expect(isDingTalkAccountConfigured(account)).toBe(false);
  });
});
