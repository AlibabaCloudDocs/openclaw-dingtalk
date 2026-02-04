/**
 * DingTalk AI Card Instance APIs.
 * Handles create/update/append spaces for interactive cards.
 */

import type { ResolvedDingTalkAccount } from "../accounts.js";
import type { StreamLogger } from "../stream/types.js";
import { createTokenManagerFromAccount, type TokenManager } from "./token-manager.js";

export interface CardInstanceResult {
  ok: boolean;
  cardInstanceId?: string;
  raw?: unknown;
  error?: Error;
}

export interface CreateCardInstanceOptions {
  account: ResolvedDingTalkAccount;
  templateId: string;
  outTrackId: string;
  cardData: Record<string, unknown>;
  privateData?: Record<string, unknown>;
  openSpace?: Record<string, unknown>;
  openSpaceId?: string;
  callbackType?: "STREAM" | "HTTP";
  tokenManager?: TokenManager;
  logger?: StreamLogger;
}

export interface UpdateCardInstanceOptions {
  account: ResolvedDingTalkAccount;
  cardInstanceId?: string;
  outTrackId?: string;
  cardData?: Record<string, unknown>;
  privateData?: Record<string, unknown>;
  openSpace?: Record<string, unknown>;
  openSpaceId?: string;
  callbackType?: "STREAM" | "HTTP";
  tokenManager?: TokenManager;
  logger?: StreamLogger;
}

export interface AppendCardSpacesOptions {
  account: ResolvedDingTalkAccount;
  cardInstanceId: string;
  openSpace?: Record<string, unknown>;
  openSpaceId?: string;
  tokenManager?: TokenManager;
  logger?: StreamLogger;
}

async function getAccessToken(
  account: ResolvedDingTalkAccount,
  tokenManager: TokenManager,
  logger?: StreamLogger,
  action: string = "card"
): Promise<string> {
  try {
    return await tokenManager.getToken();
  } catch (err) {
    logger?.error?.(
      { err: { message: (err as Error)?.message } },
      `Failed to get access token for ${action}`
    );
    throw err as Error;
  }
}

function extractCardInstanceId(data: any): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  return (
    data.cardInstanceId ||
    data.cardInstanceID ||
    data.card_instance_id ||
    data.instanceId ||
    data.id
  );
}

/**
 * Create a new card instance.
 * API: POST /v1.0/card/instances
 */
export async function createCardInstance(
  opts: CreateCardInstanceOptions
): Promise<CardInstanceResult> {
  const {
    account,
    templateId,
    outTrackId,
    cardData,
    privateData,
    openSpace,
    openSpaceId,
    callbackType,
    tokenManager: providedTokenManager,
    logger,
  } = opts;

  if (!templateId) {
    return { ok: false, error: new Error("Missing templateId") };
  }
  if (!outTrackId) {
    return { ok: false, error: new Error("Missing outTrackId") };
  }
  if (!cardData) {
    return { ok: false, error: new Error("Missing cardData") };
  }

  const tokenManager = providedTokenManager ?? createTokenManagerFromAccount(account, logger);
  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, tokenManager, logger, "card create");
  } catch (err) {
    return { ok: false, error: err as Error };
  }
  const url = `${account.apiBase}/v1.0/card/instances`;

  const body: Record<string, unknown> = {
    cardTemplateId: templateId,
    outTrackId,
    cardData,
  };

  if (privateData) body.privateData = privateData;
  if (callbackType) body.callbackType = callbackType;
  if (openSpaceId) body.openSpaceId = openSpaceId;
  if (openSpace && typeof openSpace === "object") {
    Object.assign(body, openSpace);
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": accessToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const respText = await resp.text();
    let data: any = {};
    try {
      data = respText ? JSON.parse(respText) : {};
    } catch {
      data = { raw: respText };
    }

    if (!resp.ok) {
      logger?.error?.(
        { status: resp.status, error: respText.slice(0, 200) },
        "Card instance create failed"
      );
      return {
        ok: false,
        error: new Error(`HTTP ${resp.status}: ${respText.slice(0, 200)}`),
        raw: data,
      };
    }

    const cardInstanceId = extractCardInstanceId(data);
    logger?.debug?.({ cardInstanceId, outTrackId }, "Card instance created");
    return { ok: true, cardInstanceId, raw: data };
  } catch (err) {
    logger?.error?.(
      { err: { message: (err as Error)?.message } },
      "Card instance create error"
    );
    return { ok: false, error: err as Error };
  }
}

/**
 * Update an existing card instance.
 * API: PUT /v1.0/card/instances
 */
export async function updateCardInstance(
  opts: UpdateCardInstanceOptions
): Promise<CardInstanceResult> {
  const {
    account,
    cardInstanceId,
    outTrackId,
    cardData,
    privateData,
    openSpace,
    openSpaceId,
    callbackType,
    tokenManager: providedTokenManager,
    logger,
  } = opts;

  if (!cardInstanceId && !outTrackId) {
    return { ok: false, error: new Error("Missing cardInstanceId or outTrackId") };
  }

  const tokenManager = providedTokenManager ?? createTokenManagerFromAccount(account, logger);
  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, tokenManager, logger, "card update");
  } catch (err) {
    return { ok: false, error: err as Error };
  }
  const url = `${account.apiBase}/v1.0/card/instances`;

  const body: Record<string, unknown> = {
    cardInstanceId,
    outTrackId,
  };

  if (cardData) body.cardData = cardData;
  if (privateData) body.privateData = privateData;
  if (callbackType) body.callbackType = callbackType;
  if (openSpaceId) body.openSpaceId = openSpaceId;
  if (openSpace && typeof openSpace === "object") {
    Object.assign(body, openSpace);
  }

  try {
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": accessToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const respText = await resp.text();
    let data: any = {};
    try {
      data = respText ? JSON.parse(respText) : {};
    } catch {
      data = { raw: respText };
    }

    if (!resp.ok) {
      logger?.error?.(
        { status: resp.status, error: respText.slice(0, 200) },
        "Card instance update failed"
      );
      return {
        ok: false,
        error: new Error(`HTTP ${resp.status}: ${respText.slice(0, 200)}`),
        raw: data,
      };
    }

    const resolvedId = extractCardInstanceId(data) ?? cardInstanceId;
    logger?.debug?.({ cardInstanceId: resolvedId, outTrackId }, "Card instance updated");
    return { ok: true, cardInstanceId: resolvedId, raw: data };
  } catch (err) {
    logger?.error?.(
      { err: { message: (err as Error)?.message } },
      "Card instance update error"
    );
    return { ok: false, error: err as Error };
  }
}

/**
 * Append or update card open spaces.
 * API: PUT /v1.0/card/instances/spaces (fallback POST if PUT fails)
 */
export async function appendCardSpaces(
  opts: AppendCardSpacesOptions
): Promise<CardInstanceResult> {
  const {
    account,
    cardInstanceId,
    openSpace,
    openSpaceId,
    tokenManager: providedTokenManager,
    logger,
  } = opts;

  if (!cardInstanceId) {
    return { ok: false, error: new Error("Missing cardInstanceId") };
  }

  const tokenManager = providedTokenManager ?? createTokenManagerFromAccount(account, logger);
  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, tokenManager, logger, "card spaces");
  } catch (err) {
    return { ok: false, error: err as Error };
  }
  const url = `${account.apiBase}/v1.0/card/instances/spaces`;

  const body: Record<string, unknown> = {
    cardInstanceId,
  };
  if (openSpaceId) body.openSpaceId = openSpaceId;
  if (openSpace && typeof openSpace === "object") {
    Object.assign(body, openSpace);
  }

  async function request(method: "PUT" | "POST"): Promise<CardInstanceResult> {
    const resp = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": accessToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const respText = await resp.text();
    let data: any = {};
    try {
      data = respText ? JSON.parse(respText) : {};
    } catch {
      data = { raw: respText };
    }

    if (!resp.ok) {
      return {
        ok: false,
        error: new Error(`HTTP ${resp.status}: ${respText.slice(0, 200)}`),
        raw: data,
      };
    }

    const resolvedId = extractCardInstanceId(data) ?? cardInstanceId;
    return { ok: true, cardInstanceId: resolvedId, raw: data };
  }

  try {
    const result = await request("PUT");
    if (result.ok) {
      logger?.debug?.({ cardInstanceId }, "Card spaces appended (PUT)");
      return result;
    }

    logger?.warn?.({ cardInstanceId, err: result.error?.message }, "Card spaces PUT failed, retry POST");
    const retry = await request("POST");
    if (!retry.ok) {
      logger?.error?.({ cardInstanceId, err: retry.error?.message }, "Card spaces append failed");
    }
    return retry;
  } catch (err) {
    logger?.error?.(
      { err: { message: (err as Error)?.message } },
      "Card spaces append error"
    );
    return { ok: false, error: err as Error };
  }
}
