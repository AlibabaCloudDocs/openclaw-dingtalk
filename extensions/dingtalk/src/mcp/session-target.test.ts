import { describe, expect, it } from "vitest";
import { resolveDingTalkTargetFromSessionKey } from "./session-target.js";

describe("resolveDingTalkTargetFromSessionKey", () => {
  it("parses dingtalk dm session", () => {
    const target = resolveDingTalkTargetFromSessionKey("agent:main:dingtalk:dm:user001");
    expect(target).toBe("dingtalk:dm:user001");
  });

  it("parses dingtalk group session and strips user-isolation suffix", () => {
    const target = resolveDingTalkTargetFromSessionKey(
      "agent:main:dingtalk:group:cid123456:user:staff001",
    );
    expect(target).toBe("dingtalk:group:cid123456");
  });

  it("returns undefined for non-dingtalk session", () => {
    const target = resolveDingTalkTargetFromSessionKey("agent:main:slack:channel:C123");
    expect(target).toBeUndefined();
  });
});

