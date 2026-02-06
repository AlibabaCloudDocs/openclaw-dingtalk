import { describe, expect, it } from "vitest";
import { dingtalkPlugin } from "./channel.js";

describe("dingtalkPlugin configSchema", () => {
  it("uses grouped settings structure for Control UI", () => {
    const schema = dingtalkPlugin.configSchema?.schema as {
      properties?: Record<string, unknown>;
    };
    const properties = schema?.properties ?? {};

    expect(properties.enabled).toBeDefined();
    expect(properties.credentials).toBeDefined();
    expect(properties.conversation).toBeDefined();
    expect(properties.reply).toBeDefined();
    expect(properties.streaming).toBeDefined();
    expect(properties.connection).toBeDefined();
    expect(properties.aiCard).toBeDefined();
    expect(properties.aliyunMcp).toBeDefined();
    expect(properties.clientId).toBeUndefined();
    expect(properties.replyMode).toBeUndefined();
  });

  it("provides uiHints for new grouped paths", () => {
    const hints = dingtalkPlugin.configSchema?.uiHints ?? {};

    expect(hints.credentials?.label).toContain("接入凭据");
    expect(hints["credentials.clientId"]?.label).toContain("Client ID");
    expect(hints["conversation.requireMention"]?.label).toContain("@机器人");
    expect(hints["reply.thinking"]?.label).toContain("思考");
    expect(hints["reply.coalesce.enabled"]?.label).toContain("合并");
    expect(hints["streaming.blockStreaming"]?.label).toContain("流式");
    expect(hints["connection.apiBase"]?.label).toContain("API");
  });
});
