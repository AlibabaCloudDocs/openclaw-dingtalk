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

function truncateText(value: string, maxLen: number = 500): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...(truncated)`;
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

/**
 * Start DingTalk Stream client using the official SDK.
 * Maintains persistent WebSocket connection with auto-reconnect.
 */
export async function startDingTalkStreamClient(
  options: StreamClientOptions
): Promise<StreamClientHandle> {
  const { clientId, clientSecret, logger, onChatMessage, onCardCallback } = options;

  logger?.info?.({ clientId: clientId?.slice(0, 8) + "..." }, "Initializing DingTalk Stream SDK client");

  // Create DWClient instance from SDK
  const client = new DWClient({
    clientId,
    clientSecret,
    debug: !!logger?.debug,
    keepAlive: true,
  });

  // Register robot message callback
  client.registerCallbackListener(TOPIC_ROBOT, async (res: DWClientDownStream) => {
    logger?.debug?.(
      { topic: res.headers.topic, messageId: res.headers.messageId },
      "Received robot message callback"
    );

    // Explicitly acknowledge receipt to prevent DingTalk 60s timeout retry
    // The SDK does not auto-ACK for callbacks, so we must do it manually.
    try {
      client.socketCallBackResponse(res.headers.messageId, { status: "received" });
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
      logger?.debug?.(
        { eventType: res.headers.eventType, topic: res.headers.topic },
        "Stream event ignored (not chatbot message)"
      );
      return;
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
    logger?.debug?.(
      { topic: res.headers.topic, messageId: res.headers.messageId },
      "Received AI Card callback"
    );

    try {
      client.socketCallBackResponse(res.headers.messageId, { status: "received" });
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
      logger?.debug?.(
        { eventType: res.headers.eventType, topic: res.headers.topic },
        "Stream event ignored (not card callback)"
      );
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
    logger?.debug?.(
      { type: message.type, topic: message.headers?.topic, eventType: message.headers?.eventType },
      "Received stream event"
    );
    return { status: EventAck.SUCCESS };
  });

  // Connect to DingTalk Stream
  try {
    await client.connect();
    logger?.info?.("DingTalk Stream SDK connected successfully");
  } catch (err) {
    logger?.error?.({ err: getConnectionErrorDetails(err) }, "DingTalk Stream SDK connection failed");
    throw err;
  }

  return {
    stop: () => {
      logger?.info?.("Stopping DingTalk Stream SDK client");
      client.disconnect();
    },
  };
}
