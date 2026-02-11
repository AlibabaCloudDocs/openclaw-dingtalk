import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { ResolvedDingTalkAccount } from "./accounts.js";
import type { StreamLogger } from "./stream/types.js";
import {
  createTokenManagerFromAccount,
  clearAllTokens,
  type TokenManager,
} from "./api/token-manager.js";

let runtime: PluginRuntime | null = null;

export function setDingTalkRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getDingTalkRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("DingTalk runtime not initialized");
  }
  return runtime;
}

/**
 * Token manager cache keyed by accountId.
 */
const tokenManagerCache = new Map<string, TokenManager>();

/**
 * AI card streaming state cache keyed by sessionKey.
 */
export type CardStreamState = {
  cardInstanceId?: string;
  outTrackId: string;
  templateId?: string;
  inputingStarted?: boolean;
  delivered?: boolean;
  contentKey?: string;
  accumulatedText?: string;
  finalizedAt?: number;
  lastUpdateAt: number;
};

const cardStreamCache = new Map<string, CardStreamState>();
const CARD_STREAM_CACHE_MAX = 5_000;
const CARD_STREAM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CARD_STREAM_CACHE_SWEEP_EVERY = 200;
let cardStreamOps = 0;

function sweepCardStreamCache(nowMs: number = Date.now()): void {
  // TTL is based on lastUpdateAt (streaming heartbeat). If a state is stuck and never finalized,
  // we still cap retention to avoid unbounded growth.
  for (const [key, state] of cardStreamCache.entries()) {
    const last = typeof state.lastUpdateAt === "number" ? state.lastUpdateAt : 0;
    if (last && nowMs - last > CARD_STREAM_CACHE_TTL_MS) {
      cardStreamCache.delete(key);
    }
  }

  while (cardStreamCache.size > CARD_STREAM_CACHE_MAX) {
    const first = cardStreamCache.keys().next().value as string | undefined;
    if (!first) break;
    cardStreamCache.delete(first);
  }
}

/**
 * Get or create a token manager for a DingTalk account.
 * Token managers are cached by accountId to reuse access tokens.
 */
export function getOrCreateTokenManager(
  account: ResolvedDingTalkAccount,
  logger?: StreamLogger
): TokenManager {
  const existing = tokenManagerCache.get(account.accountId);
  if (existing) {
    return existing;
  }

  const manager = createTokenManagerFromAccount(account, logger);
  tokenManagerCache.set(account.accountId, manager);
  return manager;
}

/**
 * Invalidate token manager for a specific account.
 * Call this when credentials are rotated.
 */
export function invalidateTokenManager(accountId: string): void {
  const manager = tokenManagerCache.get(accountId);
  if (manager) {
    manager.invalidate();
    tokenManagerCache.delete(accountId);
  }
}

/**
 * Clear all token managers.
 * Useful for cleanup or testing.
 */
export function clearTokenManagers(): void {
  for (const manager of tokenManagerCache.values()) {
    manager.invalidate();
  }
  tokenManagerCache.clear();
  clearAllTokens();
}

export function getCardStreamState(sessionKey: string): CardStreamState | undefined {
  cardStreamOps += 1;
  if (cardStreamOps % CARD_STREAM_CACHE_SWEEP_EVERY === 0) {
    sweepCardStreamCache();
  }
  return cardStreamCache.get(sessionKey);
}

export function setCardStreamState(sessionKey: string, state: CardStreamState): void {
  cardStreamOps += 1;
  cardStreamCache.set(sessionKey, state);
  if (
    cardStreamOps % CARD_STREAM_CACHE_SWEEP_EVERY === 0 ||
    cardStreamCache.size > CARD_STREAM_CACHE_MAX
  ) {
    sweepCardStreamCache();
  }
}

export function clearCardStreamState(sessionKey: string): void {
  cardStreamCache.delete(sessionKey);
}

export function clearCardStreamStates(): void {
  cardStreamCache.clear();
  cardStreamOps = 0;
}
