import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  ensureCoreWebSearchDisabledForAliyun,
} from "./core-search-sync.js";
import { DINGTALK_CHANNEL_ID } from "../config-schema.js";

function buildConfig(params: { webSearchEnabled: boolean; coreSearchEnabled: boolean }) {
  return {
    tools: {
      web: {
        search: {
          enabled: params.coreSearchEnabled,
        },
      },
    },
    channels: {
      [DINGTALK_CHANNEL_ID]: {
        aliyunMcp: {
          tools: {
            webSearch: { enabled: params.webSearchEnabled },
          },
        },
      },
    },
  } as any;
}

describe("ensureCoreWebSearchDisabledForAliyun", () => {
  beforeEach(() => {
    __testing.resetCoreSearchSyncState();
  });

  it("writes config once when aliyun webSearch is enabled and core search is not disabled", async () => {
    let currentConfig = buildConfig({
      webSearchEnabled: true,
      coreSearchEnabled: true,
    });
    const writeConfigFile = vi.fn(async (nextConfig: any) => {
      currentConfig = nextConfig;
    });
    const runtime = {
      config: {
        loadConfig: vi.fn(() => currentConfig),
        writeConfigFile,
      },
    } as any;

    const result = await ensureCoreWebSearchDisabledForAliyun({
      pluginConfig: {},
      clawConfig: currentConfig,
      runtime,
    });

    expect(result).toBe("updated");
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    expect(currentConfig.tools.web.search.enabled).toBe(false);
  });

  it("deduplicates concurrent sync attempts", async () => {
    const currentConfig = buildConfig({
      webSearchEnabled: true,
      coreSearchEnabled: true,
    });

    let resolveWrite: (() => void) | null = null;
    const writeConfigFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const runtime = {
      config: {
        loadConfig: vi.fn(() => currentConfig),
        writeConfigFile,
      },
    } as any;

    const first = ensureCoreWebSearchDisabledForAliyun({
      pluginConfig: {},
      clawConfig: currentConfig,
      runtime,
    });
    const second = ensureCoreWebSearchDisabledForAliyun({
      pluginConfig: {},
      clawConfig: currentConfig,
      runtime,
    });

    const secondResult = await second;
    expect(secondResult).toBe("in_flight");
    expect(writeConfigFile).toHaveBeenCalledTimes(1);

    resolveWrite?.();
    const firstResult = await first;
    expect(firstResult).toBe("updated");
  });

  it("skips write when core search is already disabled", async () => {
    const currentConfig = buildConfig({
      webSearchEnabled: true,
      coreSearchEnabled: false,
    });
    const writeConfigFile = vi.fn(async () => {});
    const runtime = {
      config: {
        loadConfig: vi.fn(() => currentConfig),
        writeConfigFile,
      },
    } as any;

    const result = await ensureCoreWebSearchDisabledForAliyun({
      pluginConfig: {},
      clawConfig: currentConfig,
      runtime,
    });

    expect(result).toBe("already_disabled");
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("logs warn and returns failed when writeConfigFile throws", async () => {
    const currentConfig = buildConfig({
      webSearchEnabled: true,
      coreSearchEnabled: true,
    });
    const warn = vi.fn();
    const runtime = {
      config: {
        loadConfig: vi.fn(() => currentConfig),
        writeConfigFile: vi.fn(async () => {
          throw new Error("write failed");
        }),
      },
    } as any;

    const result = await ensureCoreWebSearchDisabledForAliyun({
      pluginConfig: {},
      clawConfig: currentConfig,
      runtime,
      logger: { warn },
    });

    expect(result).toBe("failed");
    expect(warn).toHaveBeenCalled();
  });
});
