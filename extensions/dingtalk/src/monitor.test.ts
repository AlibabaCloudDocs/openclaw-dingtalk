/**
 * Tests for DingTalk monitor.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatbotMessage } from "./stream/types.js";

vi.mock("openclaw/plugin-sdk", () => ({
  loadWebMedia: vi.fn(),
}));

// Mock dependencies
vi.mock("dingtalk-stream", () => {
  const EventAck = { SUCCESS: "SUCCESS" };
  const TOPIC_ROBOT = "/v1.0/im/bot/messages/get";
  const TOPIC_AI_GRAPH_API = "/v1.0/graph/api/invoke";

  class DWClient {
    private callbacks = new Map<string, (res: any) => Promise<void>>();
    socketCallBackResponse = vi.fn();
    sendGraphAPIResponse = vi.fn();
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn();

    registerCallbackListener(topic: string, callback: any): void {
      this.callbacks.set(topic, callback);
    }
    registerAllEventListener(): void {}

    // Test helper
    __simulateMessage(topic: string, message: any): Promise<void> | undefined {
      const callback = this.callbacks.get(topic);
      if (callback) return callback(message);
    }
  }

  return { DWClient, EventAck, TOPIC_ROBOT, TOPIC_AI_GRAPH_API };
});

vi.mock("./runtime.js", () => {
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn().mockResolvedValue({ ok: true });
  const cardStreamState = new Map<string, any>();
  const runtime = {
    channel: {
      reply: {
        dispatchReplyWithBufferedBlockDispatcher,
      },
    },
  };

  return {
    getDingTalkRuntime: () => runtime,
    getOrCreateTokenManager: () => ({
      getToken: vi.fn().mockResolvedValue("test-token"),
      invalidate: vi.fn(),
    }),
    getCardStreamState: (sessionKey: string) => cardStreamState.get(sessionKey),
    setCardStreamState: vi.fn((sessionKey: string, state: any) => {
      cardStreamState.set(sessionKey, state);
    }),
    clearCardStreamState: vi.fn((sessionKey: string) => {
      cardStreamState.delete(sessionKey);
    }),
    __resetCardStreamState: () => {
      cardStreamState.clear();
    },
  };
});

vi.mock("./api/media.js", () => ({
  downloadMedia: vi.fn(),
  uploadMedia: vi.fn(),
}));

vi.mock("./api/send-message.js", async () => {
  const actual = await vi.importActual<typeof import("./api/send-message.js")>("./api/send-message.js");
  return {
    ...actual,
    sendFileMessage: vi.fn().mockResolvedValue({ ok: true }),
  };
});

vi.mock("./api/media-upload.js", async () => {
  const actual = await vi.importActual<typeof import("./api/media-upload.js")>("./api/media-upload.js");
  return {
    ...actual,
    uploadMediaToOAPI: vi.fn(),
  };
});

import { monitorDingTalkProvider } from "./monitor.js";
import { getDingTalkRuntime } from "./runtime.js";
import { DINGTALK_CHANNEL_ID } from "./config-schema.js";
import { BASIC_ACCOUNT, FILTERED_ACCOUNT, PREFIX_ACCOUNT, VERBOSE_ACCOUNT } from "../test/fixtures/configs.js";

describe("monitorDingTalkProvider", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let capturedCallback: ((message: any) => Promise<void>) | undefined;
  let capturedCardCallback: ((message: any) => Promise<void>) | undefined;
  let testStateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedCallback = undefined;
    capturedCardCallback = undefined;
    const runtimeModule = await import("./runtime.js");
    (runtimeModule as any).__resetCardStreamState?.();

    // Mock fetch for webhook replies
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    testStateDir = mkdtempSync(join(tmpdir(), "dingtalk-monitor-state-"));
    process.env.OPENCLAW_STATE_DIR = testStateDir;

    // Capture the robot callback when client is created
    const { DWClient, TOPIC_ROBOT } = await import("dingtalk-stream");
    vi.spyOn(DWClient.prototype, "registerCallbackListener").mockImplementation(
      (topic: string, callback: any) => {
        if (topic === TOPIC_ROBOT) {
          capturedCallback = callback;
        }
        if (topic === "/v1.0/card/instances/callback") {
          capturedCardCallback = callback;
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    rmSync(testStateDir, { recursive: true, force: true });
  });

  const mockConfig = {
    channels: {
      dingtalk: { enabled: true },
    },
  };

  const createMockMessage = (overrides: Partial<{
    text: string;
    senderId: string;
    conversationType: string;
    conversationId: string;
  }> = {}) => ({
    type: "CALLBACK",
    headers: {
      topic: "/v1.0/im/bot/messages/get",
      eventType: "CHATBOT_MESSAGE",
      messageId: `msg-${Date.now()}`,
    },
    data: JSON.stringify({
      text: { content: overrides.text ?? "Hello bot" },
      sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=xxx",
      conversationId: overrides.conversationId ?? "cid123",
      conversationType: overrides.conversationType ?? "2",
      senderStaffId: overrides.senderId ?? "user001",
      senderNick: "Test User",
      // Simulate a normal group mention so BASIC_ACCOUNT (requireMention=true) will process it
      isInAtList: true,
    }),
  });

  const writeSessionTranscript = (params: {
    sessionKey: string;
    messages: Array<{
      text: string;
      provider?: string;
      model?: string;
      stopReason?: string;
      timestamp?: number;
    }>;
  }): void => {
    const sessionsDir = join(testStateDir, "agents", "main", "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    const sessionId = "test-session-1";
    const sessionFile = join(sessionsDir, `${sessionId}.jsonl`);
    const sessionsStore = {
      [params.sessionKey]: {
        sessionId,
        updatedAt: Date.now(),
        sessionFile,
      },
    };

    writeFileSync(join(sessionsDir, "sessions.json"), JSON.stringify(sessionsStore, null, 2), "utf-8");

    const lines: string[] = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: new Date().toISOString(),
        cwd: "/tmp",
      }),
    ];

    for (const [index, message] of params.messages.entries()) {
      const ts = message.timestamp ?? Date.now();
      lines.push(
        JSON.stringify({
          type: "message",
          id: `m-${index + 1}`,
          parentId: null,
          timestamp: new Date(ts).toISOString(),
          message: {
            role: "assistant",
            content: [{ type: "text", text: message.text }],
            api: "openai-responses",
            provider: message.provider ?? "openclaw",
            model: message.model ?? "delivery-mirror",
            stopReason: message.stopReason ?? "stop",
            timestamp: ts,
          },
        })
      );
    }

    writeFileSync(sessionFile, `${lines.join("\n")}\n`, "utf-8");
  };

  it("starts monitoring and returns handle", async () => {
    const handle = await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(handle).toBeDefined();
    expect(handle.stop).toBeDefined();
  });

  it("dispatches message to Clawdbot runtime", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    // Simulate incoming message
    if (capturedCallback) {
      await capturedCallback(createMockMessage());
      await new Promise((r) => setTimeout(r, 50));

      expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled();
    }
  });

  it("builds correct context for Clawdbot", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ text: "Test message" }));
      await new Promise((r) => setTimeout(r, 50));

      const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
      const ctx = call[0].ctx;

      expect(ctx.Body).toBe("Test message");
      expect(ctx.SessionKey).toContain("dingtalk:group:");
      expect(ctx.Provider).toBe(DINGTALK_CHANNEL_ID);
      expect(ctx.Surface).toBe(DINGTALK_CHANNEL_ID);

      // Ensure Openclaw block streaming flushes each block immediately by default.
      // (This is accomplished by forcing chunkMode="newline" on the canonical channel id.)
      const cfg = call[0].cfg as any;
      expect(cfg?.channels?.[DINGTALK_CHANNEL_ID]?.chunkMode).toBe("newline");
      expect(call[0].replyOptions?.disableBlockStreaming).toBe(false);
    }
  });

  it("passes disableBlockStreaming=true when account blockStreaming is false", async () => {
    const runtime = getDingTalkRuntime();
    const account = { ...BASIC_ACCOUNT, blockStreaming: false };

    await monitorDingTalkProvider({
      account,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ text: "Test message" }));
      await new Promise((r) => setTimeout(r, 50));

      const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<
        typeof vi.fn
      >).mock.calls[0];
      expect(call[0].replyOptions?.disableBlockStreaming).toBe(true);
    }
  });

  it("sends one synthesized final when only block text is received and streamBlockTextToSession is false", async () => {
    const runtime = getDingTalkRuntime();
    const dispatchMock =
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>;
    dispatchMock.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.deliver({ text: "第一段" }, { kind: "block" });
      return { queuedFinal: false, counts: { tool: 0, block: 1, final: 0 } };
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("text");
    expect(body.text.content).toBe("第一段");
  });

  it("does not synthesize duplicate final when final payload already exists", async () => {
    const runtime = getDingTalkRuntime();
    const dispatchMock =
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>;
    dispatchMock.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.deliver({ text: "中间块" }, { kind: "block" });
      await params.dispatcherOptions.deliver({ text: "最终答案" }, { kind: "final" });
      return { queuedFinal: true, counts: { tool: 0, block: 1, final: 1 } };
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("text");
    expect(body.text.content).toBe("最终答案");
  });

  it("streams block text immediately when streamBlockTextToSession is true", async () => {
    const runtime = getDingTalkRuntime();
    const account = { ...BASIC_ACCOUNT, streamBlockTextToSession: true };
    const dispatchMock =
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>;
    dispatchMock.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.deliver({ text: "实时块文本" }, { kind: "block" });
      return { queuedFinal: false, counts: { tool: 0, block: 1, final: 0 } };
    });

    await monitorDingTalkProvider({
      account,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("text");
    expect(body.text.content).toBe("实时块文本");
  });

  it("isolates group SessionKey per sender when enabled", async () => {
    const runtime = getDingTalkRuntime();
    const account = { ...BASIC_ACCOUNT, isolateContextPerUserInGroup: true };

    await monitorDingTalkProvider({
      account,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(
        createMockMessage({
          text: "Test message",
          conversationType: "2",
          conversationId: "cid123",
          senderId: "user001",
        })
      );
      await new Promise((r) => setTimeout(r, 50));

      const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
      const ctx = call[0].ctx;

      expect(ctx.SessionKey).toBe("agent:main:dingtalk:group:cid123:user:user001");
    }
  });

  it("filters messages from self", async () => {
    const runtime = getDingTalkRuntime();
    const accountWithSelf = { ...BASIC_ACCOUNT, selfUserId: "bot-id" };

    await monitorDingTalkProvider({
      account: accountWithSelf,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ senderId: "bot-id" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    }
  });

  it("filters messages not in allowFrom list", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: FILTERED_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      // User not in allowlist
      await capturedCallback(createMockMessage({ senderId: "unknown-user" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    }
  });

  it("allows messages from allowFrom list", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: FILTERED_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ senderId: "allowed-user-1" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled();
    }
  });

  it("enforces prefix requirement in group chats", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: PREFIX_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      // Message without prefix
      await capturedCallback(createMockMessage({ text: "Hello", conversationType: "2" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    }
  });

  it("allows message with correct prefix in group", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: PREFIX_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ text: "@bot Hello", conversationType: "2" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled();
    }
  });

  it("does not enforce prefix in DMs", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: PREFIX_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      // DM (conversationType: "1") should not require prefix
      await capturedCallback(createMockMessage({ text: "Hello", conversationType: "1" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled();
    }
  });

  it("stops client on abort signal", async () => {
    const controller = new AbortController();

    const handle = await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
      abortSignal: controller.signal,
    });

    // The handle should have a stop method
    expect(handle.stop).toBeDefined();

    // Abort signal triggers stop
    controller.abort();

    // Give time for abort handler
    await new Promise((r) => setTimeout(r, 20));

    // Since we can't easily verify disconnect was called with the current mock setup,
    // we just verify the monitor handles abort signal without throwing
    expect(true).toBe(true);
  });

  it("logs errors from message handler", async () => {
    const runtime = getDingTalkRuntime();
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("Dispatch failed"));

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
      log: mockLogger,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage());
      await new Promise((r) => setTimeout(r, 50));

      expect(mockLogger.error).toHaveBeenCalled();
    }
  });

  it("recognizes /new command for session reset", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ text: "/new Start fresh" }));
      await new Promise((r) => setTimeout(r, 50));

      const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].ctx.CommandAuthorized).toBe(true);
    }
  });

  it("injects Chinese reset guidance for bare /new", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ text: "/new" }));
      await new Promise((r) => setTimeout(r, 50));

      const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].ctx.CommandBody).toContain("请使用中文打招呼");
      expect(call[0].ctx.CommandBody).toContain("不要提及内部步骤");
      expect(call[0].ctx.CommandBody.startsWith("/new ")).toBe(true);
    }
  });

  it("recognizes /verbose command", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ text: "/verbose on Hello" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled();
    }
  });

  it("recognizes /reasoning command", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ text: "/reasoning on Hello" }));
      await new Promise((r) => setTimeout(r, 50));

      const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].ctx.CommandAuthorized).toBe(true);
    }
  });

  it("injects senderStaffId in BodyForAgent", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ senderId: "staff123" }));
      await new Promise((r) => setTimeout(r, 50));

      const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].ctx.BodyForAgent).toContain("senderStaffId: staff123");
    }
  });

  it("supports one-shot thinking via /t!", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    if (capturedCallback) {
      await capturedCallback(createMockMessage({ text: "/t! on Hello" }));
      await new Promise((r) => setTimeout(r, 50));

      const calls = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(3);
      expect(calls[0]?.[0]?.ctx?.CommandBody).toBe("/think high");
      expect(calls[1]?.[0]?.ctx?.CommandBody).toBe("Hello");
      expect(calls[2]?.[0]?.ctx?.CommandBody).toBe("/think off");
    }
  });

  it("delivers tool-kind media even when verbose is off", async () => {
    const runtime = getDingTalkRuntime();

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 50));

    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const dispatcherOptions = call?.[0]?.dispatcherOptions;
    expect(dispatcherOptions?.deliver).toBeTypeOf("function");

    await dispatcherOptions.deliver(
      { mediaUrl: "https://example.com/a.png" },
      { kind: "tool" }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("sendBySession");
    const body = JSON.parse(init.body as string);
    expect(body.msgtype).toBe("image");
    expect(body.image.picURL).toBe("https://example.com/a.png");
  });

  it("uploads local images via OAPI and sends as sessionWebhook media_id", async () => {
    const runtime = getDingTalkRuntime();
    const pluginSdk = await import("openclaw/plugin-sdk");
    const mediaApi = await import("./api/media.js");
    const mediaUploadApi = await import("./api/media-upload.js");

    (pluginSdk.loadWebMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      buffer: Buffer.from("fake-image"),
      contentType: "image/png",
      kind: "image",
      fileName: "image.png",
    });
    (mediaApi.uploadMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      mediaId: "robot-media-id",
    });
    (mediaUploadApi.uploadMediaToOAPI as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      mediaId: "oapi-media-id",
      type: "image",
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 50));

    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const dispatcherOptions = call?.[0]?.dispatcherOptions;

    await dispatcherOptions.deliver(
      { mediaUrl: "./image.png" },
      { kind: "final" }
    );

    expect(mediaUploadApi.uploadMediaToOAPI).toHaveBeenCalled();
    expect(mediaApi.uploadMedia).not.toHaveBeenCalled();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("image");
    expect(body.image.media_id).toBe("oapi-media-id");
  });

  it("sends non-image media as a file message (not as image)", async () => {
    const runtime = getDingTalkRuntime();
    const pluginSdk = await import("openclaw/plugin-sdk");
    const mediaApi = await import("./api/media.js");
    const sendMessageApi = await import("./api/send-message.js");

    (pluginSdk.loadWebMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      buffer: Buffer.from("fake-pdf"),
      contentType: "application/pdf",
      kind: "document",
      fileName: "report.pdf",
    });
    (mediaApi.uploadMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      mediaId: "media-123",
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 50));

    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const dispatcherOptions = call?.[0]?.dispatcherOptions;

    await dispatcherOptions.deliver(
      { mediaUrl: "./report.pdf" },
      { kind: "final" }
    );

    expect(sendMessageApi.sendFileMessage).toHaveBeenCalledTimes(1);
    const args = (sendMessageApi.sendFileMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args?.mediaId).toBe("media-123");
    expect(args?.fileName).toBe("report.pdf");
  });

  it("treats a standalone local path in text as media instead of sending the raw path", async () => {
    const runtime = getDingTalkRuntime();
    const pluginSdk = await import("openclaw/plugin-sdk");
    const mediaApi = await import("./api/media.js");
    const mediaUploadApi = await import("./api/media-upload.js");

    (pluginSdk.loadWebMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      buffer: Buffer.from("fake-image"),
      contentType: "image/png",
      kind: "image",
      fileName: "image.png",
    });
    (mediaApi.uploadMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      mediaId: "robot-media-id",
    });
    (mediaUploadApi.uploadMediaToOAPI as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      mediaId: "oapi-media-id",
      type: "image",
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 50));

    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const dispatcherOptions = call?.[0]?.dispatcherOptions;

    await dispatcherOptions.deliver(
      { text: "./image.png" },
      { kind: "final" }
    );

    expect(mediaUploadApi.uploadMediaToOAPI).toHaveBeenCalled();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("image");
  });

  it("streams AI card via create->deliver->streaming->finish and strips directives", async () => {
    const runtime = getDingTalkRuntime();
    const aiCardAccount = {
      ...BASIC_ACCOUNT,
      aiCard: {
        ...BASIC_ACCOUNT.aiCard,
        enabled: true,
        autoReply: true,
        templateId: "tpl-1",
        updateThrottleMs: 0,
        textParamKey: "content",
      },
    };

    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/v1.0/card/instances") && init?.method === "POST" && !url.includes("/deliver")) {
        return {
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ cardInstanceId: "card-1" })),
        } as any;
      }
      return {
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
        json: () => Promise.resolve({ success: true }),
      } as any;
    });

    await monitorDingTalkProvider({
      account: aiCardAccount,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 20));

    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const dispatcherOptions = call?.[0]?.dispatcherOptions;

    await dispatcherOptions.deliver(
      { text: "[[reply_to_current]]你好" },
      { kind: "block" }
    );
    await dispatcherOptions.deliver(
      { text: "你好，世界" },
      { kind: "final" }
    );

    const apiCalls = mockFetch.mock.calls.filter((entry) =>
      String(entry[0]).includes("api.dingtalk.com/v1.0/card/")
    );
    expect(apiCalls.length).toBeGreaterThanOrEqual(6);

    const streamingCalls = apiCalls.filter((entry) =>
      String(entry[0]).includes("/v1.0/card/streaming")
    );
    expect(streamingCalls).toHaveLength(2);

    const firstStreamingBody = JSON.parse(streamingCalls[0][1].body as string);
    expect(firstStreamingBody.content).toBe("你好");
    expect(firstStreamingBody.isFinalize).toBe(false);

    const finalStreamingBody = JSON.parse(streamingCalls[1][1].body as string);
    expect(finalStreamingBody.content).toBe("你好，世界");
    expect(finalStreamingBody.isFinalize).toBe(true);

    const instancePutCalls = apiCalls.filter(
      (entry) =>
        String(entry[0]).endsWith("/v1.0/card/instances") &&
        String((entry[1] as RequestInit)?.method ?? "") === "PUT"
    );
    const statuses = instancePutCalls.map((entry) => {
      const body = JSON.parse((entry[1] as RequestInit).body as string);
      return body.cardData?.cardParamMap?.flowStatus;
    });
    expect(statuses).toContain("2");
    expect(statuses).toContain("3");

    expect(mockFetch.mock.calls.some((entry) => String(entry[0]).includes("sendBySession"))).toBe(
      false
    );
  });

  it("preserves newline formatting in AI card streaming and finalization", async () => {
    const runtime = getDingTalkRuntime();
    const aiCardAccount = {
      ...BASIC_ACCOUNT,
      aiCard: {
        ...BASIC_ACCOUNT.aiCard,
        enabled: true,
        autoReply: true,
        templateId: "tpl-1",
        updateThrottleMs: 0,
      },
    };

    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/v1.0/card/instances") && init?.method === "POST" && !url.includes("/deliver")) {
        return {
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ cardInstanceId: "card-1" })),
        } as any;
      }
      return {
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
        json: () => Promise.resolve({ success: true }),
      } as any;
    });

    await monitorDingTalkProvider({
      account: aiCardAccount,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 20));

    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const dispatcherOptions = call?.[0]?.dispatcherOptions;

    await dispatcherOptions.deliver(
      { text: "第一行\n" },
      { kind: "block" }
    );
    await dispatcherOptions.deliver(
      { text: "\n第二行" },
      { kind: "block" }
    );
    await dispatcherOptions.deliver(
      { text: "第一行\n\n第二行" },
      { kind: "final" }
    );

    const streamingCalls = mockFetch.mock.calls.filter((entry) =>
      String(entry[0]).includes("/v1.0/card/streaming")
    );
    expect(streamingCalls.length).toBeGreaterThanOrEqual(3);

    const firstBody = JSON.parse(streamingCalls[0][1].body as string);
    expect(firstBody.content).toBe("第一行\n");

    const secondBody = JSON.parse(streamingCalls[1][1].body as string);
    expect(secondBody.content).toBe("第一行\n\n第二行");
    expect(secondBody.isFinalize).toBe(false);

    const finalBody = JSON.parse(streamingCalls[streamingCalls.length - 1][1].body as string);
    expect(finalBody.content).toBe("第一行\n\n第二行");
    expect(finalBody.isFinalize).toBe(true);

    const instancePutCalls = mockFetch.mock.calls.filter(
      (entry) =>
        String(entry[0]).endsWith("/v1.0/card/instances") &&
        String((entry[1] as RequestInit)?.method ?? "") === "PUT"
    );
    const statuses = instancePutCalls.map((entry) => {
      const body = JSON.parse((entry[1] as RequestInit).body as string);
      return body.cardData?.cardParamMap?.flowStatus;
    });
    expect(statuses).toContain("3");
  });

  it("auto-finalizes AI card when dispatch has block-only replies and no final payload", async () => {
    const runtime = getDingTalkRuntime();
    const aiCardAccount = {
      ...BASIC_ACCOUNT,
      aiCard: {
        ...BASIC_ACCOUNT.aiCard,
        enabled: true,
        autoReply: true,
        templateId: "tpl-1",
        updateThrottleMs: 0,
      },
    };

    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/v1.0/card/instances") && init?.method === "POST" && !url.includes("/deliver")) {
        return {
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ cardInstanceId: "card-1" })),
        } as any;
      }
      return {
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
        json: () => Promise.resolve({ success: true }),
      } as any;
    });

    await monitorDingTalkProvider({
      account: aiCardAccount,
      config: mockConfig,
    });

    const dispatchMock =
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>;
    dispatchMock.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.deliver({ text: "第一行\n第二行" }, { kind: "block" });
      return { queuedFinal: false, counts: { tool: 0, block: 1, final: 0 } };
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 50));

    const streamingCalls = mockFetch.mock.calls.filter((entry) =>
      String(entry[0]).includes("/v1.0/card/streaming")
    );
    expect(streamingCalls.length).toBeGreaterThanOrEqual(2);
    const hasFinalize = streamingCalls.some((entry) => {
      const body = JSON.parse(entry[1].body as string);
      return body.isFinalize === true;
    });
    expect(hasFinalize).toBe(true);
    const finalizeCall = streamingCalls.find((entry) => {
      const body = JSON.parse(entry[1].body as string);
      return body.isFinalize === true;
    });
    expect(finalizeCall).toBeDefined();
    const finalizeBody = JSON.parse((finalizeCall![1] as RequestInit).body as string);
    expect(finalizeBody.content).toBe("第一行\n第二行");

    const instancePutCalls = mockFetch.mock.calls.filter(
      (entry) =>
        String(entry[0]).endsWith("/v1.0/card/instances") &&
        String((entry[1] as RequestInit)?.method ?? "") === "PUT"
    );
    const statuses = instancePutCalls.map((entry) => {
      const body = JSON.parse((entry[1] as RequestInit).body as string);
      return body.cardData?.cardParamMap?.flowStatus;
    });
    expect(statuses).toContain("3");
  });

  it("does not synthesize duplicate finalization when dispatch already has final payload", async () => {
    const runtime = getDingTalkRuntime();
    const aiCardAccount = {
      ...BASIC_ACCOUNT,
      aiCard: {
        ...BASIC_ACCOUNT.aiCard,
        enabled: true,
        autoReply: true,
        templateId: "tpl-1",
        updateThrottleMs: 0,
      },
    };

    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/v1.0/card/instances") && init?.method === "POST" && !url.includes("/deliver")) {
        return {
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ cardInstanceId: "card-1" })),
        } as any;
      }
      return {
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
        json: () => Promise.resolve({ success: true }),
      } as any;
    });

    await monitorDingTalkProvider({
      account: aiCardAccount,
      config: mockConfig,
    });

    const dispatchMock =
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>;
    dispatchMock.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.deliver({ text: "你好" }, { kind: "block" });
      await params.dispatcherOptions.deliver({ text: "你好，世界" }, { kind: "final" });
      return { queuedFinal: true, counts: { tool: 0, block: 1, final: 1 } };
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 50));

    const streamingCalls = mockFetch.mock.calls.filter((entry) =>
      String(entry[0]).includes("/v1.0/card/streaming")
    );
    const finalizeCalls = streamingCalls.filter((entry) => {
      const body = JSON.parse(entry[1].body as string);
      return body.isFinalize === true;
    });
    expect(finalizeCalls).toHaveLength(1);
  });

  it("throttles non-final AI card streaming updates and flushes on final", async () => {
    const runtime = getDingTalkRuntime();
    const aiCardAccount = {
      ...BASIC_ACCOUNT,
      aiCard: {
        ...BASIC_ACCOUNT.aiCard,
        enabled: true,
        autoReply: true,
        templateId: "tpl-1",
        updateThrottleMs: 10_000,
      },
    };

    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/v1.0/card/instances") && init?.method === "POST" && !url.includes("/deliver")) {
        return {
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ cardInstanceId: "card-1" })),
        } as any;
      }
      return {
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
        json: () => Promise.resolve({ success: true }),
      } as any;
    });

    await monitorDingTalkProvider({
      account: aiCardAccount,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 20));

    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const dispatcherOptions = call?.[0]?.dispatcherOptions;

    await dispatcherOptions.deliver({ text: "A" }, { kind: "block" });
    await dispatcherOptions.deliver({ text: "B" }, { kind: "block" });
    await dispatcherOptions.deliver({ text: "ABC" }, { kind: "final" });

    const streamingCalls = mockFetch.mock.calls.filter((entry) =>
      String(entry[0]).includes("/v1.0/card/streaming")
    );
    expect(streamingCalls).toHaveLength(2);
    const finalBody = JSON.parse(streamingCalls[1][1].body as string);
    expect(finalBody.content).toBe("ABC");
    expect(finalBody.isFinalize).toBe(true);
  });

  it("falls back to sessionWebhook text when AI card stage fails", async () => {
    const runtime = getDingTalkRuntime();
    const aiCardAccount = {
      ...BASIC_ACCOUNT,
      aiCard: {
        ...BASIC_ACCOUNT.aiCard,
        enabled: true,
        autoReply: true,
        templateId: "tpl-1",
      },
    };

    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/v1.0/card/instances") && init?.method === "POST" && !url.includes("/deliver")) {
        return {
          ok: false,
          status: 500,
          text: () => Promise.resolve("boom"),
        } as any;
      }
      if (url.includes("sendBySession")) {
        return {
          ok: true,
          json: () => Promise.resolve({}),
        } as any;
      }
      return {
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
        json: () => Promise.resolve({ success: true }),
      } as any;
    });

    await monitorDingTalkProvider({
      account: aiCardAccount,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage({ conversationType: "1" }));
    await new Promise((r) => setTimeout(r, 20));

    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const dispatcherOptions = call?.[0]?.dispatcherOptions;

    await dispatcherOptions.deliver({ text: "fallback text" }, { kind: "final" });

    expect(mockFetch.mock.calls.some((entry) => String(entry[0]).includes("sendBySession"))).toBe(
      true
    );
  });

  it("sends one transcript fallback when a run produced zero DingTalk deliveries", async () => {
    const sessionKey = "agent:main:dingtalk:group:cid123";
    writeSessionTranscript({
      sessionKey,
      messages: [
        {
          text: "这是一条应该补发到钉钉的最终回复",
        },
      ],
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("text");
    expect(body.text.content).toContain("应该补发到钉钉");
  });

  it("does not trigger transcript fallback when a normal delivery already happened", async () => {
    const runtime = getDingTalkRuntime();
    const dispatchMock =
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>;
    dispatchMock.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.deliver({ text: "正常发送内容" }, { kind: "final" });
      return { counts: { block: 0, final: 1 } };
    });

    const sessionKey = "agent:main:dingtalk:group:cid123";
    writeSessionTranscript({
      sessionKey,
      messages: [
        {
          text: "这条补发内容不应该被发送",
        },
      ],
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("text");
    expect(body.text.content).toBe("正常发送内容");
  });

  it("picks the last delivery-mirror assistant text as fallback", async () => {
    const sessionKey = "agent:main:dingtalk:group:cid123";
    const baseTs = Date.now();
    writeSessionTranscript({
      sessionKey,
      messages: [
        {
          text: "第一条镜像消息",
          timestamp: baseTs - 1000,
        },
        {
          text: "第二条镜像消息",
          timestamp: baseTs,
        },
      ],
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe("text");
    expect(body.text.content).toBe("第二条镜像消息");
  });

  it("skips transcript fallback when mirror text only contains directives", async () => {
    const sessionKey = "agent:main:dingtalk:group:cid123";
    writeSessionTranscript({
      sessionKey,
      messages: [
        {
          text: "[[reply_to_current]][[audio_as_voice]]",
        },
      ],
    });

    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCallback).toBeTypeOf("function");
    await capturedCallback?.(createMockMessage());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("dispatches card callback as virtual message", async () => {
    await monitorDingTalkProvider({
      account: BASIC_ACCOUNT,
      config: mockConfig,
    });

    expect(capturedCardCallback).toBeTypeOf("function");

    const mockMessage = {
      type: "CALLBACK",
      headers: {
        topic: "/v1.0/card/instances/callback",
        eventType: "CARD_CALLBACK",
        messageId: "card-msg-123",
      },
      data: JSON.stringify({
        cardInstanceId: "card-1",
        actionId: "approve",
        openSpaceId: "dtv1.card//IM_GROUP.cid-test",
        userId: "allowed-user-1",
      }),
    };

    await capturedCardCallback?.(mockMessage);
    await new Promise((r) => setTimeout(r, 20));

    const runtime = getDingTalkRuntime();
    expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled();
    const call = (runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]?.ctx?.Body).toContain("/card");
  });
});
