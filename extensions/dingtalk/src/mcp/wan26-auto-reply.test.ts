import { describe, expect, it } from "vitest";
import { autoSendWan26MediaToDingtalk, extractWan26MediaUrls } from "./wan26-auto-reply.js";

describe("extractWan26MediaUrls", () => {
  it("extracts media urls from nested payload", () => {
    const urls = extractWan26MediaUrls({
      output: {
        imageUrl: "https://example.com/cover.png",
        items: [
          {
            video_url: "https://example.com/movie.mp4",
          },
        ],
      },
      text: "ignore https://example.com/readme",
    });
    expect(urls).toContain("https://example.com/cover.png");
    expect(urls).toContain("https://example.com/movie.mp4");
    expect(urls).not.toContain("https://example.com/readme");
  });
});

describe("autoSendWan26MediaToDingtalk", () => {
  it("skips when channel is not dingtalk", async () => {
    const result = await autoSendWan26MediaToDingtalk({
      payload: { imageUrl: "https://example.com/a.png" },
      messageChannel: "telegram",
      sessionKey: "agent:main:dingtalk:dm:user001",
      config: {} as any,
    });
    expect(result.skippedReason).toBe("not_dingtalk_channel");
  });

  it("skips when session key cannot resolve dingtalk target", async () => {
    const result = await autoSendWan26MediaToDingtalk({
      payload: { imageUrl: "https://example.com/a.png" },
      messageChannel: "clawdbot-dingtalk",
      sessionKey: "agent:main:slack:channel:C1",
      config: {} as any,
    });
    expect(result.skippedReason).toBe("missing_dingtalk_session_target");
  });
});

