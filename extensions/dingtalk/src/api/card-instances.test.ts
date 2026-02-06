/**
 * Tests for DingTalk AI card instance APIs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  appendCardSpaces,
  createAndDeliverCardInstance,
  createCardInstance,
  deliverCardInstance,
  updateCardInstance,
} from "./card-instances.js";
import { clearAllTokens } from "./token-manager.js";
import { BASIC_ACCOUNT } from "../../test/fixtures/configs.js";

describe("card instances API", () => {
  beforeEach(() => {
    clearAllTokens();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates card instance", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accessToken: "test-token", expireIn: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ cardInstanceId: "card-123" })),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await createCardInstance({
      account: BASIC_ACCOUNT,
      templateId: "tpl-1",
      outTrackId: "track-1",
      cardData: { foo: "bar" },
      callbackType: "STREAM",
      openSpaceId: "dtv1.card//IM_GROUP.cid123",
    });

    expect(result.ok).toBe(true);
    expect(result.cardInstanceId).toBe("card-123");
    const call = mockFetch.mock.calls[1];
    expect(call[0]).toContain("/v1.0/card/instances");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body);
    expect(body.cardTemplateId).toBe("tpl-1");
    expect(body.outTrackId).toBe("track-1");
  });

  it("updates card instance", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accessToken: "test-token", expireIn: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ cardInstanceId: "card-123" })),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await updateCardInstance({
      account: BASIC_ACCOUNT,
      cardInstanceId: "card-123",
      outTrackId: "track-1",
      cardData: { foo: "baz" },
    });

    expect(result.ok).toBe(true);
    const call = mockFetch.mock.calls[1];
    expect(call[0]).toContain("/v1.0/card/instances");
    expect(call[1].method).toBe("PUT");
    const body = JSON.parse(call[1].body);
    expect(body.cardInstanceId).toBe("card-123");
  });

  it("appends card spaces with PUT", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accessToken: "test-token", expireIn: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ cardInstanceId: "card-123" })),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await appendCardSpaces({
      account: BASIC_ACCOUNT,
      cardInstanceId: "card-123",
      openSpaceId: "dtv1.card//IM_GROUP.cid123",
    });

    expect(result.ok).toBe(true);
    const call = mockFetch.mock.calls[1];
    expect(call[0]).toContain("/v1.0/card/instances/spaces");
    expect(call[1].method).toBe("PUT");
  });

  it("treats deliverResults failure as API error for createAndDeliver", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accessToken: "test-token", expireIn: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(
          JSON.stringify({
            result: {
              deliverResults: [
                { spaceType: "IM", spaceId: "IM_ALL", success: false, errorMsg: "spaces of card is empty" },
              ],
              outTrackId: "track-1",
            },
            success: true,
          })
        ),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await createAndDeliverCardInstance({
      account: BASIC_ACCOUNT,
      templateId: "tpl-1",
      outTrackId: "track-1",
      cardData: { text: "hello" },
      callbackType: "STREAM",
      openSpaceId: "dtv1.card//im_robot.user001",
      userId: "user001",
      userIdType: 1,
      robotCode: BASIC_ACCOUNT.clientId,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("spaces of card is empty");
  });

  it("treats deliver result array failure as API error for deliver", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accessToken: "test-token", expireIn: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(
          JSON.stringify({
            result: [
              { spaceType: "IM", spaceId: "IM_ALL", success: false, errorMsg: "spaces of card is empty" },
            ],
            success: true,
          })
        ),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await deliverCardInstance({
      account: BASIC_ACCOUNT,
      outTrackId: "track-2",
      openSpaceId: "dtv1.card//im_robot.user001",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("spaces of card is empty");
  });
});
