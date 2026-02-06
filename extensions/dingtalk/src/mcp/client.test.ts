import { describe, expect, it } from "vitest";
import { detectWan26Intent, selectWan26RemoteToolName } from "./client.js";

describe("detectWan26Intent", () => {
  it("defaults drawing/photo prompts to image", () => {
    const intent = detectWan26Intent({
      arguments: {
        prompt: "帮我画一幅乌鸦喝水的照片",
      },
    });
    expect(intent).toBe("image");
  });

  it("detects video intent from prompt text", () => {
    const intent = detectWan26Intent({
      arguments: {
        prompt: "生成一个 10 秒的视频短片",
      },
    });
    expect(intent).toBe("video");
  });

  it("detects task status intent from task_id", () => {
    const intent = detectWan26Intent({
      arguments: {
        task_id: "abc123",
      },
    });
    expect(intent).toBe("task_status");
  });
});

describe("selectWan26RemoteToolName", () => {
  const availableNames = [
    "modelstudio_text_to_video_wan26_submit_task",
    "modelstudio_wanx26_image_generation",
    "modelstudio_text_to_video_wan26_fetch_task",
  ];

  it("prefers image generation tool for image intent", () => {
    const selected = selectWan26RemoteToolName({
      availableNames,
      intent: "image",
    });
    expect(selected).toBe("modelstudio_wanx26_image_generation");
  });

  it("honors explicit preferred remote tool name", () => {
    const selected = selectWan26RemoteToolName({
      availableNames,
      intent: "image",
      preferredRemoteToolName: "modelstudio_text_to_video_wan26_submit_task",
    });
    expect(selected).toBe("modelstudio_text_to_video_wan26_submit_task");
  });
});
