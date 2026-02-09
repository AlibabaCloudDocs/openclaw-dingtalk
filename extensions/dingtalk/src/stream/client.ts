/**
 * DingTalk Stream API client.
 * Uses the official dingtalk-stream SDK for WebSocket connections.
 */

import {
  DWClient,
  type DWClientDownStream,
  EventAck,
  TOPIC_ROBOT,
  TOPIC_AI_GRAPH_API,
} from "dingtalk-stream";
import type {
  ChatbotMessage,
  CardCallbackMessage,
  StreamClientHandle,
  StreamClientOptions,
  StreamLogger,
} from "./types.js";
import { extractChatbotMessage } from "./message-parser.js";
import { extractCardCallback } from "./card-callback.js";

const TOPIC_CARD_INSTANCE_CALLBACK = "/v1.0/card/instances/callback";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 8000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30000;
const DEFAULT_DEDUP_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DEDUP_MAX_SIZE = 5000;

function isTraceEnabled(): boolean {
  const v =
    process.env.OPENCLAW_DINGTALK_STREAM_TRACE?.trim() ??
    process.env.DINGTALK_STREAM_TRACE?.trim() ??
    "";
  return v === "1" || v.toLowerCase() === "true";
}

function truncateText(value: string, maxLen: number = 500): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...(truncated)`;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the Node process alive solely for reconnect waits.
    (t as any)?.unref?.();
  });
}

function serializeUnknown(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return truncateText(value);
  try {
    return truncateText(JSON.stringify(value));
  } catch {
    return "[unserializable]";
  }
}

function getConnectionErrorDetails(err: unknown): Record<string, unknown> {
  const anyErr = err as Record<string, any>;
  const response = anyErr?.response as Record<string, any> | undefined;
  const config = anyErr?.config as Record<string, any> | undefined;

  return {
    message: anyErr?.message,
    code: anyErr?.code,
    status: response?.status,
    statusText: response?.statusText,
    url: config?.url,
    responseBody: serializeUnknown(response?.data),
  };
}

function jitterMs(ms: number): number {
  // +/- 20% jitter
  const delta = Math.round(ms * 0.2);
  const r = Math.floor(Math.random() * (2 * delta + 1)) - delta;
  return Math.max(0, ms + r);
}

function createMessageDeduper(opts?: {
  ttlMs?: number;
  maxSize?: number;
}): { isDuplicate: (id: string) => boolean } {
  const ttlMs = opts?.ttlMs ?? DEFAULT_DEDUP_TTL_MS;
  const maxSize = opts?.maxSize ?? DEFAULT_DEDUP_MAX_SIZE;
  const seen = new Map<string, number>();

  const gc = (now: number) => {
    // TTL sweep (Map preserves insertion order).
    for (const [id, ts] of seen) {
      if (now - ts <= ttlMs) break;
      seen.delete(id);
    }
    // Size cap (drop oldest).
    while (seen.size > maxSize) {
      const first = seen.keys().next().value as string | undefined;
      if (!first) break;
      seen.delete(first);
    }
  };

  return {
    isDuplicate: (id: string) => {
      const now = Date.now();
      gc(now);
      const prev = seen.get(id);
      if (prev !== undefined && now - prev <= ttlMs) return true;
      seen.set(id, now);
      return false;
    },
  };
}

async function waitForSocketOpen(
  socket: any,
  timeoutMs: number
): Promise<void> {
  // ws readyState: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  if (socket?.readyState === 1) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const t = setTimeout(() => {
      finish(() => reject(new Error("WebSocket open timeout")));
    }, timeoutMs);
    (t as any)?.unref?.();

    socket?.once?.("open", () => finish(() => resolve()));
    socket?.once?.("error", (err: unknown) =>
      finish(() => reject(err instanceof Error ? err : new Error("WebSocket error")))
    );
    socket?.once?.("close", () => finish(() => reject(new Error("WebSocket closed before open"))));
  });
}

/**
 * Start DingTalk Stream client using the official SDK.
 * Maintains persistent WebSocket connection with auto-reconnect.
 */
export async function startDingTalkStreamClient(
  options: StreamClientOptions
): Promise<StreamClientHandle> {
  const { clientId, clientSecret, logger, onChatMessage, onCardCallback, onConnectionStatus } = options;
  const traceEnabled = isTraceEnabled();
  const deduper = createMessageDeduper();

  logger?.info?.({ clientId: clientId?.slice(0, 8) + "..." }, "Initializing DingTalk Stream SDK client");

  // Create DWClient instance from SDK
  const client = new DWClient({
    clientId,
    clientSecret,
    // Never enable SDK debug logs: the upstream SDK may log config objects that include secrets.
    // We keep our own structured logger for diagnostics instead.
    debug: false,
    // The upstream SDK's reconnect path can trigger unhandled rejections on endpoint fetch errors.
    // We implement our own reconnect + heartbeat supervisor here.
    autoReconnect: false,
    keepAlive: false,
  } as any);

  // Register robot message callback
  client.registerCallbackListener(TOPIC_ROBOT, async (res: DWClientDownStream) => {
    const cbMeta = {
      topic: res.headers.topic,
      messageId: res.headers.messageId,
      type: res.type,
      eventType: res.headers?.eventType,
    };
    if (traceEnabled) {
      logger?.info?.(cbMeta, "DingTalk stream callback received");
    } else {
      logger?.debug?.(cbMeta, "Received robot message callback");
    }

    // Explicitly acknowledge receipt to prevent DingTalk 60s timeout retry
    // The SDK does not auto-ACK for callbacks, so we must do it manually.
    try {
      client.socketCallBackResponse(res.headers.messageId, { status: "received" });
      if (traceEnabled) {
        logger?.info?.(
          { messageId: res.headers.messageId, topic: res.headers.topic },
          "DingTalk stream callback ACK sent"
        );
      }
    } catch (err) {
      logger?.error?.({ err: { message: (err as Error)?.message } }, "Failed to send ACK");
    }

    // Parse the data field (it's a JSON string)
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(res.data);
    } catch {
      logger?.warn?.({ data: res.data?.slice?.(0, 100) }, "Failed to parse robot message data");
      return;
    }

    // Build a RawStreamMessage compatible object for extractChatbotMessage
    const rawMessage = {
      type: res.type,
      headers: res.headers,
      data: parsedData,
    };

    const chat = extractChatbotMessage(rawMessage);
    if (!chat) {
      const ignoredMeta = { eventType: res.headers.eventType, topic: res.headers.topic, messageId: res.headers.messageId };
      if (traceEnabled) {
        logger?.info?.(ignoredMeta, "Stream callback ignored (not chatbot message)");
      } else {
        logger?.debug?.(ignoredMeta, "Stream event ignored (not chatbot message)");
      }
      return;
    }

    // DingTalk may retry delivery; de-duplicate by messageId (best-effort).
    if (chat.messageId && deduper.isDuplicate(chat.messageId)) {
      const dupMeta = { messageId: chat.messageId, topic: res.headers.topic, eventType: res.headers.eventType };
      if (traceEnabled) {
        logger?.info?.(dupMeta, "Duplicate DingTalk message ignored");
      } else {
        logger?.debug?.(dupMeta, "Duplicate DingTalk message ignored");
      }
      return;
    }

    if (traceEnabled) {
      logger?.info?.(
        {
          messageId: chat.messageId,
          senderId: chat.senderId,
          conversationId: chat.conversationId,
          textPreview: truncateText(chat.text ?? "", 160),
        },
        "DingTalk message extracted"
      );
    }

    // Process message asynchronously to prevent DingTalk 60s timeout retry
    // The callback must return immediately to acknowledge receipt
    onChatMessage(chat).catch((err) => {
      logger?.error?.({ err: { message: (err as Error)?.message } }, "onChatMessage handler error");
    });
  });

  // Register AI Graph API callback (for future AI plugin support)
  client.registerCallbackListener(TOPIC_AI_GRAPH_API, async (res: DWClientDownStream) => {
    logger?.info?.(
      { topic: res.headers.topic, messageId: res.headers.messageId },
      "Received AI Graph API callback (not yet implemented)"
    );

    // Acknowledge receipt - actual handling can be added later
    try {
      client.sendGraphAPIResponse(res.headers.messageId, {
        response: {
          statusLine: {
            code: 501,
            reasonPhrase: "Not Implemented",
          },
          headers: {},
          body: JSON.stringify({ error: "AI Graph API not yet implemented" }),
        },
      });
    } catch (err) {
      logger?.error?.({ err: { message: (err as Error)?.message } }, "Failed to send AI Graph API response");
    }
  });

  // Register AI Card callback
  client.registerCallbackListener(TOPIC_CARD_INSTANCE_CALLBACK, async (res: DWClientDownStream) => {
    const cbMeta = {
      topic: res.headers.topic,
      messageId: res.headers.messageId,
      type: res.type,
      eventType: res.headers?.eventType,
    };
    if (traceEnabled) {
      logger?.info?.(cbMeta, "DingTalk stream callback received (card)");
    } else {
      logger?.debug?.(cbMeta, "Received AI Card callback");
    }

    try {
      client.socketCallBackResponse(res.headers.messageId, { status: "received" });
      if (traceEnabled) {
        logger?.info?.(
          { messageId: res.headers.messageId, topic: res.headers.topic },
          "DingTalk stream callback ACK sent (card)"
        );
      }
    } catch (err) {
      logger?.error?.({ err: { message: (err as Error)?.message } }, "Failed to send card callback ACK");
    }

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(res.data);
    } catch {
      parsedData = res.data;
    }

    const rawMessage = {
      type: res.type,
      headers: res.headers,
      data: parsedData,
    };

    const callback = extractCardCallback(rawMessage);
    if (!callback) {
      const ignoredMeta = { eventType: res.headers.eventType, topic: res.headers.topic, messageId: res.headers.messageId };
      if (traceEnabled) {
        logger?.info?.(ignoredMeta, "Stream callback ignored (not card callback)");
      } else {
        logger?.debug?.(ignoredMeta, "Stream event ignored (not card callback)");
      }
      return;
    }

    if (!onCardCallback) {
      logger?.debug?.({ messageId: callback.messageId }, "No card callback handler registered");
      return;
    }

    onCardCallback(callback as CardCallbackMessage).catch((err) => {
      logger?.error?.({ err: { message: (err as Error)?.message } }, "onCardCallback handler error");
    });
  });

  // Register global event listener for all events (logging + ack)
  client.registerAllEventListener((message: DWClientDownStream) => {
    const meta = {
      type: message.type,
      topic: message.headers?.topic,
      eventType: message.headers?.eventType,
      messageId: message.headers?.messageId,
    };
    if (traceEnabled) {
      logger?.info?.(meta, "DingTalk stream event received");
    } else {
      logger?.debug?.(meta, "Received stream event");
    }
    return { status: EventAck.SUCCESS };
  });

  let stopped = false;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let activeSocket: any | undefined;

  const clearHeartbeat = () => {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const attachHeartbeat = (socket: any) => {
    clearHeartbeat();
    let isAlive = true;
    socket?.on?.("pong", () => {
      isAlive = true;
    });
    heartbeatTimer = setInterval(() => {
      if (!socket || socket.readyState !== 1) return;
      if (!isAlive) {
        // If DingTalk stops responding to pings, force a reconnect.
        logger?.warn?.({ wsReadyState: socket.readyState }, "DingTalk stream heartbeat missed; terminating socket");
        try {
          socket.terminate();
        } catch {}
        return;
      }
      isAlive = false;
      try {
        socket.ping("", true);
      } catch {}
    }, DEFAULT_HEARTBEAT_INTERVAL_MS);
    (heartbeatTimer as any)?.unref?.();
  };

  const connectOnce = async () => {
    await client.connect();
    const socket = (client as any).socket;
    if (!socket) throw new Error("DingTalk Stream SDK did not create a WebSocket");
    activeSocket = socket;
    await waitForSocketOpen(socket, DEFAULT_CONNECT_TIMEOUT_MS);
    attachHeartbeat(socket);
    logger?.info?.("DingTalk Stream SDK connected successfully");
    onConnectionStatus?.({ connected: true, ts: Date.now(), reason: "connected" });
  };

  const runSupervisor = async () => {
    let delayMs = DEFAULT_RECONNECT_BASE_DELAY_MS;
    while (!stopped) {
      try {
        await connectOnce();
        delayMs = DEFAULT_RECONNECT_BASE_DELAY_MS;

        const socket = activeSocket;
        if (!socket) continue;
        await new Promise<void>((resolve) => {
          const onClose = () => resolve();
          const onError = () => resolve();
          socket?.once?.("close", onClose);
          socket?.once?.("error", onError);
        });
        onConnectionStatus?.({ connected: false, ts: Date.now(), reason: "socket_closed" });
      } catch (err) {
        logger?.error?.({ err: getConnectionErrorDetails(err) }, "DingTalk Stream SDK connection failed");
        onConnectionStatus?.({ connected: false, ts: Date.now(), reason: "connect_failed" });
      } finally {
        clearHeartbeat();
      }

      if (stopped) break;
      await sleepMs(jitterMs(delayMs));
      delayMs = Math.min(DEFAULT_RECONNECT_MAX_DELAY_MS, Math.round(delayMs * 1.6));
    }
  };

  // Run in background: never crash the gateway on transient network issues.
  void runSupervisor();

  return {
    stop: () => {
      stopped = true;
      clearHeartbeat();
      logger?.info?.("Stopping DingTalk Stream SDK client");
      onConnectionStatus?.({ connected: false, ts: Date.now(), reason: "stopped" });
      client.disconnect();
    },
  };
}
