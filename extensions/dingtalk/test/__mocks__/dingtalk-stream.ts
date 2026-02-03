/**
 * Mock for dingtalk-stream SDK.
 * Provides DWClient mock for testing stream client functionality.
 */
import { vi } from "vitest";

export const EventAck = {
  SUCCESS: "SUCCESS",
  LATER: "LATER",
  UNKNOWN: "UNKNOWN",
};

export const TOPIC_ROBOT = "/v1.0/im/bot/messages/get";
export const TOPIC_AI_GRAPH_API = "/v1.0/graph/api/invoke";

type CallbackListener = (res: DWClientDownStream) => Promise<void> | void;
type EventListener = (message: DWClientDownStream) => { status: string };

export interface DWClientDownStream {
  type?: string;
  headers: {
    topic?: string;
    eventType?: string;
    messageId?: string;
    [key: string]: unknown;
  };
  data: string;
}

export class DWClient {
  private callbacks: Map<string, CallbackListener> = new Map();
  private eventListener?: EventListener;
  private options: { clientId: string; clientSecret: string; debug?: boolean; keepAlive?: boolean };

  socketCallBackResponse = vi.fn();
  sendGraphAPIResponse = vi.fn();
  connect = vi.fn().mockResolvedValue(undefined);
  disconnect = vi.fn();

  constructor(options: { clientId: string; clientSecret: string; debug?: boolean; keepAlive?: boolean }) {
    this.options = options;
  }

  registerCallbackListener(topic: string, callback: CallbackListener): void {
    this.callbacks.set(topic, callback);
  }

  registerAllEventListener(listener: EventListener): void {
    this.eventListener = listener;
  }

  /**
   * Test helper: simulate receiving a message.
   */
  __simulateMessage(topic: string, message: DWClientDownStream): void {
    const callback = this.callbacks.get(topic);
    if (callback) {
      callback(message);
    }
    if (this.eventListener) {
      this.eventListener(message);
    }
  }

  /**
   * Test helper: get registered callback for a topic.
   */
  __getCallback(topic: string): CallbackListener | undefined {
    return this.callbacks.get(topic);
  }
}
