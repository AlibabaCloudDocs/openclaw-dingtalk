import { describe, expect, it } from "vitest";
import { DingTalkConfigSchema } from "./config-schema.js";

describe("DingTalkConfigSchema", () => {
  it("parses grouped Control UI config paths", () => {
    const parsed = DingTalkConfigSchema.parse({
      credentials: {
        clientId: "grouped-client-id",
        clientSecret: "grouped-client-secret",
      },
      conversation: {
        allowFrom: ["user-1"],
        requireMention: false,
      },
      reply: {
        replyMode: "markdown",
        coalesce: {
          enabled: true,
          minChars: 600,
          maxChars: 1500,
          idleMs: 900,
        },
      },
      streaming: {
        blockStreaming: false,
      },
      connection: {
        apiBase: "https://api.example.com",
      },
    });

    expect(parsed.credentials?.clientId).toBe("grouped-client-id");
    expect(parsed.conversation?.allowFrom).toEqual(["user-1"]);
    expect(parsed.reply?.replyMode).toBe("markdown");
    expect(parsed.reply?.coalesce?.minChars).toBe(600);
    expect(parsed.streaming?.blockStreaming).toBe(false);
    expect(parsed.connection?.apiBase).toBe("https://api.example.com");
  });

  it("parses legacy flat config paths", () => {
    const parsed = DingTalkConfigSchema.parse({
      clientId: "legacy-client-id",
      clientSecret: "legacy-client-secret",
      replyMode: "text",
      blockStreaming: true,
    });

    expect(parsed.clientId).toBe("legacy-client-id");
    expect(parsed.clientSecret).toBe("legacy-client-secret");
    expect(parsed.replyMode).toBe("text");
    expect(parsed.blockStreaming).toBe(true);
  });

  it("parses grouped account overrides for multi-account config", () => {
    const parsed = DingTalkConfigSchema.parse({
      accounts: {
        team1: {
          credentials: {
            clientId: "team1-client-id",
          },
          conversation: {
            requireMention: false,
          },
          reply: {
            showToolStatus: true,
            coalesce: {
              enabled: false,
            },
          },
        },
      },
    });

    expect(parsed.accounts?.team1?.credentials?.clientId).toBe("team1-client-id");
    expect(parsed.accounts?.team1?.conversation?.requireMention).toBe(false);
    expect(parsed.accounts?.team1?.reply?.showToolStatus).toBe(true);
    expect(parsed.accounts?.team1?.reply?.coalesce?.enabled).toBe(false);
  });
});
