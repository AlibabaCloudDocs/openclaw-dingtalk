/**
 * DingTalk AI Card Instance APIs.
 * Handles create/update/append spaces for interactive cards.
 */

import type { ResolvedDingTalkAccount } from "../accounts.js";
import type { StreamLogger } from "../stream/types.js";
import { createTokenManagerFromAccount, type TokenManager } from "./token-manager.js";
import { normalizeCardData, normalizePrivateData } from "../util/ai-card.js";

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

export interface DeliverCardInstanceOptions {
  account: ResolvedDingTalkAccount;
  outTrackId: string;
  openSpaceId: string;
  userIdType?: number;
  imGroupOpenDeliverModel?: {
    robotCode: string;
    recipients?: string[];
  };
  imRobotOpenDeliverModel?: {
    robotCode: string;
    userIds?: string[];
  };
  tokenManager?: TokenManager;
  logger?: StreamLogger;
}

export interface CreateAndDeliverCardOptions {
  account: ResolvedDingTalkAccount;
  templateId: string;
  outTrackId: string;
  cardData: Record<string, unknown>;
  privateData?: Record<string, unknown>;
  openSpace?: Record<string, unknown>;
  openSpaceId?: string;
  callbackType?: "STREAM" | "HTTP";
  userId?: string;
  userIdType?: number;
  robotCode?: string;
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

function extractApiError(data: any): { ok: boolean; message?: string } {
  if (!data || typeof data !== "object") return { ok: true };

  const errcode = data.errcode ?? data.errorCode ?? data.code ?? data.error_code ?? data.error;
  if (typeof errcode === "number" && errcode !== 0) {
    return { ok: false, message: data.errmsg ?? data.message ?? data.errorMessage ?? String(errcode) };
  }
  if (typeof errcode === "string" && errcode !== "0" && errcode.toLowerCase() !== "ok") {
    return { ok: false, message: data.errmsg ?? data.message ?? data.errorMessage ?? errcode };
  }
  if (data.success === false) {
    return { ok: false, message: data.message ?? data.errmsg ?? "DingTalk API error" };
  }
  return { ok: true };
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
    cardData: normalizeCardData(cardData),
  };

  if (privateData) body.privateData = normalizePrivateData(privateData);
  if (callbackType) body.callbackType = callbackType;
  if (openSpace && typeof openSpace === "object") {
    Object.assign(body, openSpace);
  }
  if (openSpaceId) body.openSpaceId = openSpaceId;

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

    const apiStatus = extractApiError(data);
    if (!apiStatus.ok) {
      logger?.error?.({ error: apiStatus.message }, "Card instance create API error");
      return { ok: false, error: new Error(apiStatus.message ?? "API error"), raw: data };
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

  if (cardData) body.cardData = normalizeCardData(cardData);
  if (privateData) body.privateData = normalizePrivateData(privateData);
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

    const apiStatus = extractApiError(data);
    if (!apiStatus.ok) {
      logger?.error?.({ error: apiStatus.message }, "Card instance update API error");
      return { ok: false, error: new Error(apiStatus.message ?? "API error"), raw: data };
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

    const apiStatus = extractApiError(data);
    if (!apiStatus.ok) {
      return { ok: false, error: new Error(apiStatus.message ?? "API error"), raw: data };
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

/**
 * Deliver card instance to an open space.
 * API: POST /v1.0/card/instances/deliver
 */
export async function deliverCardInstance(
  opts: DeliverCardInstanceOptions
): Promise<CardInstanceResult> {
  const {
    account,
    outTrackId,
    openSpaceId,
    userIdType,
    imGroupOpenDeliverModel,
    imRobotOpenDeliverModel,
    tokenManager: providedTokenManager,
    logger,
  } = opts;

  if (!outTrackId) {
    return { ok: false, error: new Error("Missing outTrackId") };
  }
  if (!openSpaceId) {
    return { ok: false, error: new Error("Missing openSpaceId") };
  }

  const tokenManager = providedTokenManager ?? createTokenManagerFromAccount(account, logger);
  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, tokenManager, logger, "card deliver");
  } catch (err) {
    return { ok: false, error: err as Error };
  }

  const url = `${account.apiBase}/v1.0/card/instances/deliver`;
  const body: Record<string, unknown> = {
    outTrackId,
    openSpaceId,
  };

  if (userIdType !== undefined) body.userIdType = userIdType;
  if (imGroupOpenDeliverModel) body.imGroupOpenDeliverModel = imGroupOpenDeliverModel;
  if (imRobotOpenDeliverModel) body.imRobotOpenDeliverModel = imRobotOpenDeliverModel;

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
        "Card instance deliver failed"
      );
      return {
        ok: false,
        error: new Error(`HTTP ${resp.status}: ${respText.slice(0, 200)}`),
        raw: data,
      };
    }

    const apiStatus = extractApiError(data);
    if (!apiStatus.ok) {
      logger?.error?.({ error: apiStatus.message }, "Card instance deliver API error");
      return { ok: false, error: new Error(apiStatus.message ?? "API error"), raw: data };
    }

    logger?.debug?.({ outTrackId, openSpaceId }, "Card instance delivered");
    return { ok: true, raw: data };
  } catch (err) {
    logger?.error?.(
      { err: { message: (err as Error)?.message } },
      "Card instance deliver error"
    );
    return { ok: false, error: err as Error };
  }
}

/**
 * Create and deliver card instance in one call.
 * API: POST /v1.0/card/instances/createAndDeliver
 */
export async function createAndDeliverCardInstance(
  opts: CreateAndDeliverCardOptions
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
    userId,
    userIdType,
    robotCode,
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
    accessToken = await getAccessToken(account, tokenManager, logger, "card createAndDeliver");
  } catch (err) {
    return { ok: false, error: err as Error };
  }

  const url = `${account.apiBase}/v1.0/card/instances/createAndDeliver`;
  const body: Record<string, unknown> = {
    cardTemplateId: templateId,
    outTrackId,
    cardData: normalizeCardData(cardData),
  };

  if (privateData) body.privateData = normalizePrivateData(privateData);
  if (callbackType) body.callbackType = callbackType;
  if (openSpaceId) body.openSpaceId = openSpaceId;
  if (openSpace && typeof openSpace === "object") {
    Object.assign(body, openSpace);
  }
  if (userId) body.userId = userId;
  if (userIdType !== undefined) body.userIdType = userIdType;
  if (robotCode) body.robotCode = robotCode;

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
        "Card createAndDeliver failed"
      );
      return {
        ok: false,
        error: new Error(`HTTP ${resp.status}: ${respText.slice(0, 200)}`),
        raw: data,
      };
    }

    const apiStatus = extractApiError(data);
    if (!apiStatus.ok) {
      logger?.error?.({ error: apiStatus.message }, "Card createAndDeliver API error");
      return { ok: false, error: new Error(apiStatus.message ?? "API error"), raw: data };
    }

    const cardInstanceId = extractCardInstanceId(data);
    logger?.debug?.({ cardInstanceId, outTrackId }, "Card createAndDeliver succeeded");
    return { ok: true, cardInstanceId, raw: data };
  } catch (err) {
    logger?.error?.(
      { err: { message: (err as Error)?.message } },
      "Card createAndDeliver error"
    );
    return { ok: false, error: err as Error };
  }
}
