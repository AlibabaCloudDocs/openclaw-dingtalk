/**
 * Tests for media sender via sessionWebhook.
 *
 * We validate the outbound webhook payload shape for file/voice/video.
 * Upload is mocked (uploadMedia -> mediaId) so we don't hit real DingTalk APIs.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("../api/media.js", () => ({
  uploadMedia: vi.fn(),
}));

import { uploadMedia } from "../api/media.js";
import { sendMediaItem } from "./media-sender.js";

describe("sendMediaItem (sessionWebhook payload shape)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dingtalk-media-sender-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends file with file.media_id", async () => {
    vi.mocked(uploadMedia).mockResolvedValueOnce({ ok: true, mediaId: "mid-file-001" } as any);

    const filePath = join(dir, "report.pdf");
    writeFileSync(filePath, "fake-pdf");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendMediaItem(
      { type: "file", path: filePath, name: "report.pdf" },
      {
        account: {} as any,
        sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=xxx",
        tokenManager: {} as any,
      }
    );

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("file");
    expect(body.file.media_id).toBe("mid-file-001");
  });

  it("sends voice with voice.media_id and duration seconds", async () => {
    vi.mocked(uploadMedia).mockResolvedValueOnce({ ok: true, mediaId: "mid-audio-001" } as any);

    const filePath = join(dir, "voice.mp3");
    writeFileSync(filePath, "fake-audio");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendMediaItem(
      { type: "audio", path: filePath, name: "voice.mp3" },
      {
        account: {} as any,
        sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=xxx",
        tokenManager: {} as any,
      }
    );

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("voice");
    expect(body.voice.media_id).toBe("mid-audio-001");
    expect(body.voice.duration).toBeTypeOf("string");
    expect(Number(body.voice.duration)).toBeGreaterThan(0);
    expect(Number(body.voice.duration)).toBeLessThan(60);
  });

  it("sends video with video.media_id", async () => {
    vi.mocked(uploadMedia).mockResolvedValueOnce({ ok: true, mediaId: "mid-video-001" } as any);

    const filePath = join(dir, "demo.mp4");
    writeFileSync(filePath, "fake-video");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendMediaItem(
      { type: "video", path: filePath, name: "demo.mp4" },
      {
        account: {} as any,
        sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=xxx",
        tokenManager: {} as any,
      }
    );

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("video");
    expect(body.video.media_id).toBe("mid-video-001");
  });
});

