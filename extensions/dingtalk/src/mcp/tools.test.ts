import { describe, expect, it } from "vitest";
import { createAliyunMcpRegistrations } from "./tools.js";
import { DINGTALK_CHANNEL_ID } from "../config-schema.js";

const TOOL_NAMES = [
  "web_search",
  "aliyun_code_interpreter",
  "aliyun_web_parser",
  "aliyun_wan26_media",
] as const;

type ToggleCase = {
  webSearch: boolean;
  codeInterpreter: boolean;
  webParser: boolean;
  wan26Media: boolean;
};

function toConfig(toggles: ToggleCase) {
  return {
    aliyunMcp: {
      tools: {
        webSearch: { enabled: toggles.webSearch },
        codeInterpreter: { enabled: toggles.codeInterpreter },
        webParser: { enabled: toggles.webParser },
        wan26Media: { enabled: toggles.wan26Media },
      },
    },
  };
}

describe("createAliyunMcpRegistrations", () => {
  it("always registers four MCP tool factories", () => {
    const result = createAliyunMcpRegistrations({
      pluginConfig: {},
      clawConfig: {
        tools: {
          web: {
            search: { enabled: false },
          },
        },
      } as any,
    });
    expect(result.tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
  });

  it("supports all 16 toggle combinations via factory-level visibility", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const toggles: ToggleCase = {
        webSearch: Boolean(mask & 1),
        codeInterpreter: Boolean(mask & 2),
        webParser: Boolean(mask & 4),
        wan26Media: Boolean(mask & 8),
      };
      const result = createAliyunMcpRegistrations({
        pluginConfig: toConfig(toggles),
        clawConfig: {
          tools: {
            web: {
              search: { enabled: false },
            },
          },
        } as any,
      });
      const visibleNames = result.tools
        .filter((tool) => tool.factory({ config: { tools: { web: { search: { enabled: false } } } } as any }))
        .map((tool) => tool.name);

      const expected: string[] = [];
      if (toggles.webSearch) expected.push(TOOL_NAMES[0]);
      if (toggles.codeInterpreter) expected.push(TOOL_NAMES[1]);
      if (toggles.webParser) expected.push(TOOL_NAMES[2]);
      if (toggles.wan26Media) expected.push(TOOL_NAMES[3]);
      expect(visibleNames).toEqual(expected);
    }
  });

  it("uses channel config toggles when plugin config is empty", () => {
    const clawConfig = {
      tools: {
        web: {
          search: { enabled: false },
        },
      },
      channels: {
        [DINGTALK_CHANNEL_ID]: {
          aliyunMcp: {
            tools: {
              webSearch: { enabled: true },
              codeInterpreter: { enabled: false },
              webParser: { enabled: false },
              wan26Media: { enabled: true },
            },
          },
        },
      },
    } as any;
    const result = createAliyunMcpRegistrations({
      pluginConfig: {},
      clawConfig,
    });
    const names = result.tools
      .filter((tool) => tool.factory({ config: clawConfig }))
      .map((tool) => tool.name);
    expect(names).toEqual(["web_search", "aliyun_wan26_media"]);
  });

  it("returns null factory result when tool is disabled in runtime config", () => {
    const result = createAliyunMcpRegistrations({
      pluginConfig: toConfig({
        webSearch: true,
        codeInterpreter: false,
        webParser: false,
        wan26Media: false,
      }),
      clawConfig: {
        tools: {
          web: {
            search: { enabled: false },
          },
        },
      } as any,
    });
    const webSearch = result.tools.find((tool) => tool.name === "web_search");
    expect(webSearch).toBeTruthy();
    const runtimeTool = webSearch?.factory({
      config: {
        tools: {
          web: {
            search: { enabled: false },
          },
        },
        channels: {
          [DINGTALK_CHANNEL_ID]: {
            aliyunMcp: {
              tools: {
                webSearch: { enabled: false },
              },
            },
          },
        },
      } as any,
    });
    expect(runtimeTool).toBeNull();
  });

  it("warns no-search when plugin search is off and core search is disabled", () => {
    const result = createAliyunMcpRegistrations({
      pluginConfig: toConfig({
        webSearch: false,
        codeInterpreter: false,
        webParser: false,
        wan26Media: false,
      }),
      clawConfig: {
        tools: {
          web: {
            search: { enabled: false },
          },
        },
      } as any,
    });
    expect(result.warnings.join("\n")).toContain("No web search tool is available");
  });
});
