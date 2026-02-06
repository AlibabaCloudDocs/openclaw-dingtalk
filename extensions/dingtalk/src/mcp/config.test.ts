import { describe, expect, it } from "vitest";
import { buildAliyunMcpSearchWarnings, resolveAliyunMcpApiKey, resolveAliyunMcpConfig } from "./config.js";
import { DINGTALK_CHANNEL_ID } from "../config-schema.js";

describe("resolveAliyunMcpConfig", () => {
  it("defaults all tools to disabled", () => {
    const resolved = resolveAliyunMcpConfig({});
    expect(resolved.timeoutSeconds).toBe(60);
    expect(resolved.tools.webSearch.enabled).toBe(false);
    expect(resolved.tools.codeInterpreter.enabled).toBe(false);
    expect(resolved.tools.webParser.enabled).toBe(false);
    expect(resolved.tools.wan26Media.enabled).toBe(false);
    expect(resolved.tools.wan26Media.autoSendToDingtalk).toBe(true);
  });

  it("reads explicit values from plugin config", () => {
    const resolved = resolveAliyunMcpConfig({
      aliyunMcp: {
        apiKey: "cfg-key",
        timeoutSeconds: 88,
        tools: {
          webSearch: { enabled: true, endpoint: "https://a.example/sse" },
          codeInterpreter: { enabled: true, endpoint: "https://b.example/mcp" },
          webParser: { enabled: true, endpoint: "https://c.example/sse" },
          wan26Media: {
            enabled: true,
            endpoint: "https://d.example/sse",
            autoSendToDingtalk: false,
          },
        },
      },
    });

    expect(resolved.apiKey).toBe("cfg-key");
    expect(resolved.timeoutSeconds).toBe(88);
    expect(resolved.tools.webSearch.enabled).toBe(true);
    expect(resolved.tools.codeInterpreter.enabled).toBe(true);
    expect(resolved.tools.webParser.enabled).toBe(true);
    expect(resolved.tools.wan26Media.enabled).toBe(true);
    expect(resolved.tools.wan26Media.autoSendToDingtalk).toBe(false);
  });

  it("reads settings from channels.<id>.aliyunMcp when plugin config is empty", () => {
    const resolved = resolveAliyunMcpConfig(
      {},
      {
        clawConfig: {
          channels: {
            [DINGTALK_CHANNEL_ID]: {
              aliyunMcp: {
                timeoutSeconds: 45,
                tools: {
                  webSearch: { enabled: true, endpoint: "https://channel.example/search" },
                  wan26Media: { enabled: true, autoSendToDingtalk: false },
                },
              },
            },
          },
        } as any,
      },
    );

    expect(resolved.timeoutSeconds).toBe(45);
    expect(resolved.tools.webSearch.enabled).toBe(true);
    expect(resolved.tools.webSearch.endpoint).toBe("https://channel.example/search");
    expect(resolved.tools.wan26Media.enabled).toBe(true);
    expect(resolved.tools.wan26Media.autoSendToDingtalk).toBe(false);
  });

  it("prefers channel config over plugin config when both are present", () => {
    const resolved = resolveAliyunMcpConfig(
      {
        aliyunMcp: {
          timeoutSeconds: 99,
          apiKey: "plugin-key",
          tools: {
            webSearch: { enabled: false },
            wan26Media: { autoSendToDingtalk: true },
          },
        },
      },
      {
        clawConfig: {
          channels: {
            [DINGTALK_CHANNEL_ID]: {
              aliyunMcp: {
                timeoutSeconds: 10,
                apiKey: "channel-key",
                tools: {
                  webSearch: { enabled: true, endpoint: "https://channel.example/search" },
                  wan26Media: { autoSendToDingtalk: false },
                },
              },
            },
          },
        } as any,
      },
    );

    expect(resolved.timeoutSeconds).toBe(10);
    expect(resolved.apiKey).toBe("channel-key");
    expect(resolved.tools.webSearch.enabled).toBe(true);
    expect(resolved.tools.webSearch.endpoint).toBe("https://channel.example/search");
    expect(resolved.tools.wan26Media.autoSendToDingtalk).toBe(false);
  });
});

describe("resolveAliyunMcpApiKey", () => {
  it("prefers tool env > global env > config api key", () => {
    const config = resolveAliyunMcpConfig({
      aliyunMcp: {
        apiKey: "cfg-key",
      },
    });
    const env = {
      DASHSCOPE_MCP_WEBSEARCH_API_KEY: "tool-key",
      DASHSCOPE_API_KEY: "global-key",
    } as NodeJS.ProcessEnv;

    const resolved = resolveAliyunMcpApiKey({
      toolId: "webSearch",
      config,
      env,
    });
    expect(resolved).toBe("tool-key");
  });

  it("uses global env when tool env is absent", () => {
    const config = resolveAliyunMcpConfig({
      aliyunMcp: {
        apiKey: "cfg-key",
      },
    });
    const env = {
      DASHSCOPE_API_KEY: "global-key",
    } as NodeJS.ProcessEnv;
    const resolved = resolveAliyunMcpApiKey({
      toolId: "webParser",
      config,
      env,
    });
    expect(resolved).toBe("global-key");
  });

  it("uses config api key when env is absent", () => {
    const config = resolveAliyunMcpConfig({
      aliyunMcp: {
        apiKey: "cfg-key",
      },
    });
    const resolved = resolveAliyunMcpApiKey({
      toolId: "wan26Media",
      config,
      env: {} as NodeJS.ProcessEnv,
    });
    expect(resolved).toBe("cfg-key");
  });
});

describe("buildAliyunMcpSearchWarnings", () => {
  it("warns when both plugin and core web search are disabled", () => {
    const warnings = buildAliyunMcpSearchWarnings({
      config: resolveAliyunMcpConfig({
        aliyunMcp: { tools: { webSearch: { enabled: false } } },
      }),
      clawConfig: {
        tools: {
          web: {
            search: { enabled: false },
          },
        },
      } as any,
    });
    expect(warnings.join("\n")).toContain("No web search tool is available");
  });

  it("warns about conflict when plugin web_search is on and core is not disabled", () => {
    const warnings = buildAliyunMcpSearchWarnings({
      config: resolveAliyunMcpConfig({
        aliyunMcp: { tools: { webSearch: { enabled: true } } },
      }),
      clawConfig: {
        tools: {
          web: {
            search: { enabled: true },
          },
        },
      } as any,
    });
    expect(warnings.join("\n")).toContain("Name conflict");
  });
});
