/**
 * Mock for clawdbot/plugin-sdk peer dependency.
 * Provides minimal types and functions needed for testing.
 */
import { vi } from "vitest";

export interface ClawdbotConfig {
  channels?: Record<string, unknown>;
}

export const mockRuntime = {
  channel: {
    reply: {
      dispatchReplyWithBufferedBlockDispatcher: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
};

export function createMockConfig(overrides: Partial<ClawdbotConfig> = {}): ClawdbotConfig {
  return {
    channels: {
      dingtalk: {
        enabled: true,
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        ...overrides.channels?.dingtalk,
      },
      ...overrides.channels,
    },
    ...overrides,
  };
}
