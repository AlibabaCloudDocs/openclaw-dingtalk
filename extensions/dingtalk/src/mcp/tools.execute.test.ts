import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeAliyunMcpToolMock } = vi.hoisted(() => ({
  invokeAliyunMcpToolMock: vi.fn(),
}));

vi.mock("./client.js", () => ({
  invokeAliyunMcpTool: invokeAliyunMcpToolMock,
}));

vi.mock("./core-search-sync.js", () => ({
  ensureCoreWebSearchDisabledForAliyun: vi.fn(),
}));

vi.mock("./wan26-auto-reply.js", () => ({
  autoSendWan26MediaToDingtalk: vi.fn().mockResolvedValue({
    attempted: 0,
    sent: 0,
    mediaUrls: [],
    errors: [],
  }),
}));

import { createAliyunMcpRegistrations } from "./tools.js";

function createWan26RuntimeTool() {
  const pluginConfig = {
    aliyunMcp: {
      apiKey: "test-dashscope-key",
      tools: {
        wan26Media: {
          enabled: true,
          autoSendToDingtalk: false,
        },
      },
    },
  };
  const clawConfig = {
    tools: {
      web: {
        search: { enabled: false },
      },
    },
  } as any;
  const registrations = createAliyunMcpRegistrations({
    pluginConfig,
    clawConfig,
  });
  const wan26 = registrations.tools.find((tool) => tool.name === "aliyun_wan26_media");
  expect(wan26).toBeTruthy();
  const runtime = wan26?.factory({ config: clawConfig });
  expect(runtime).toBeTruthy();
  return runtime!;
}

describe("wan26 execution routing", () => {
  beforeEach(() => {
    invokeAliyunMcpToolMock.mockReset();
  });

  it("removes local routing meta fields and forwards preferred remote tool name", async () => {
    invokeAliyunMcpToolMock.mockResolvedValue({
      endpoint: "https://dashscope.aliyuncs.com/api/v1/mcps/Wan26Media/sse",
      protocol: "sse",
      remoteToolName: "modelstudio_wanx26_image_generation",
      availableToolNames: ["modelstudio_wanx26_image_generation"],
      result: { isError: false, data: { output: "ok" } },
    });
    const runtime = createWan26RuntimeTool();
    const input = {
      mode: "image",
      remoteToolName: "modelstudio_wanx26_image_generation",
      arguments: {
        prompt: "帮我画一幅乌鸦喝水的照片",
        size: "1024*1024",
        mode: "video",
        toolName: "modelstudio_text_to_video_wan26_submit_task",
      },
    };

    await runtime.execute("call-1", input);

    const invokeArgs = invokeAliyunMcpToolMock.mock.calls[0]?.[0];
    expect(invokeArgs).toEqual(
      expect.objectContaining({
        toolId: "wan26Media",
        preferredRemoteToolName: "modelstudio_wanx26_image_generation",
        selectionArguments: input,
        arguments: {
          prompt: "帮我画一幅乌鸦喝水的照片",
          size: "1024*1024",
        },
      }),
    );
  });

  it("classifies HTTP 401 as non-retryable auth failure with hints", async () => {
    invokeAliyunMcpToolMock.mockRejectedValue(
      new Error(
        "Error POSTing to endpoint (HTTP 401): {\"success\":false,\"errorCode\":\"MCP_ERROR\"}",
      ),
    );
    const runtime = createWan26RuntimeTool();
    const response = await runtime.execute("call-2", {
      mode: "image",
      prompt: "画一张乌鸦喝水",
    });
    const details = response.details as any;

    expect(details.error).toBe("mcp_auth_failed");
    expect(details.retryable).toBe(false);
    expect(details.httpStatus).toBe(401);
    expect(details.hints?.join("\n")).toContain("DASHSCOPE_MCP_WAN26MEDIA_API_KEY");
    expect(details.hints?.join("\n")).toContain("Wan26Media");
  });
});
