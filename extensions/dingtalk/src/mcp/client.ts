import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { ALIYUN_MCP_CONNECT_TIMEOUT_SECONDS, ALIYUN_MCP_REMOTE_TOOL_NAME_HINTS, type AliyunMcpToolId } from "./constants.js";

type LoggerLike = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type McpProtocol = "streamable-http" | "sse";
type McpTransport = StreamableHTTPClientTransport | SSEClientTransport;

type CachedMcpClient = {
  client: Client;
  transport: McpTransport;
  protocol: McpProtocol;
  endpoint: string;
  resolvedToolNames: Record<string, string>;
  availableToolNames: string[];
};

const clientCache = new Map<string, CachedMcpClient>();
const connectingCache = new Map<string, Promise<CachedMcpClient>>();

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim();
}

function buildClientCacheKey(endpoint: string, apiKey: string): string {
  return `${normalizeEndpoint(endpoint)}::${apiKey}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await promise;
  }
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.floor(timeoutMs / 1000)}s`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export type Wan26Intent = "image" | "video" | "task_status";

const WAN26_IMAGE_WORDS = /(image|photo|picture|illustration|draw|poster|wallpaper|头像|配图|海报|插画|画|图片|照片|生成图)/i;
const WAN26_VIDEO_WORDS = /(video|movie|clip|animation|text_to_video|image_to_video|短片|视频|动图|动画)/i;
const WAN26_STATUS_WORDS = /(status|fetch|poll|query|result|task_status|task_result|任务状态|查询任务|拉取结果)/i;

const WAN26_INTENT_HINTS: Record<Wan26Intent, { include: string[]; avoid: string[] }> = {
  image: {
    include: [
      "image_generation",
      "text_to_image",
      "wanx26_image",
      "wanx2.6_image",
      "image",
      "wanx",
    ],
    avoid: ["text_to_video", "image_to_video", "video", "fetch_task", "task_status", "query_task"],
  },
  video: {
    include: ["text_to_video", "image_to_video", "video_generation", "video", "wan26_video"],
    avoid: ["text_to_image", "image_generation", "fetch_task", "task_status", "query_task"],
  },
  task_status: {
    include: ["fetch_task", "query_task", "task_status", "task_result", "get_result", "status", "result"],
    avoid: ["text_to_video", "image_to_video", "text_to_image", "image_generation"],
  },
};

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || out.length >= 50) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      out.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out, depth + 1);
      if (out.length >= 50) {
        return;
      }
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    collectStrings(child, out, depth + 1);
    if (out.length >= 50) {
      return;
    }
  }
}

function parseWan26Intent(value: string | undefined): Wan26Intent | undefined {
  const normalized = normalizeName(value ?? "");
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "image" ||
    normalized === "img" ||
    normalized === "photo" ||
    normalized === "picture" ||
    normalized === "text_to_image"
  ) {
    return "image";
  }
  if (
    normalized === "video" ||
    normalized === "movie" ||
    normalized === "clip" ||
    normalized === "text_to_video" ||
    normalized === "image_to_video"
  ) {
    return "video";
  }
  if (
    normalized === "status" ||
    normalized === "task_status" ||
    normalized === "fetch" ||
    normalized === "fetch_task" ||
    normalized === "query" ||
    normalized === "result"
  ) {
    return "task_status";
  }
  if (WAN26_IMAGE_WORDS.test(normalized) && !WAN26_VIDEO_WORDS.test(normalized)) {
    return "image";
  }
  if (WAN26_VIDEO_WORDS.test(normalized) && !WAN26_IMAGE_WORDS.test(normalized)) {
    return "video";
  }
  if (WAN26_STATUS_WORDS.test(normalized)) {
    return "task_status";
  }
  return undefined;
}

function scoreByHint(name: string, include: string[], avoid: string[]): number {
  const normalized = normalizeName(name);
  let score = 0;
  for (const keyword of include) {
    if (normalized.includes(keyword)) {
      score += 3;
    }
  }
  for (const keyword of avoid) {
    if (normalized.includes(keyword)) {
      score -= 4;
    }
  }
  return score;
}

function resolveExplicitRemoteToolName(
  availableNames: string[],
  preferredRemoteToolName?: string,
): string | undefined {
  const explicit = readString(preferredRemoteToolName);
  if (!explicit) {
    return undefined;
  }
  const normalizedExplicit = normalizeName(explicit);
  const byNormalized = new Map<string, string>();
  for (const name of availableNames) {
    byNormalized.set(normalizeName(name), name);
  }
  const exact = byNormalized.get(normalizedExplicit);
  if (exact) {
    return exact;
  }
  return availableNames.find((name) => normalizeName(name).includes(normalizedExplicit));
}

export function detectWan26Intent(params: {
  arguments: Record<string, unknown>;
  preferredRemoteToolName?: string;
}): Wan26Intent {
  const explicitIntent = parseWan26Intent(
    readString(params.arguments.mode) ??
      readString(params.arguments.intent) ??
      readString(params.arguments.mediaType) ??
      readString(params.arguments.taskType),
  );
  if (explicitIntent) {
    return explicitIntent;
  }

  const explicitToolIntent = parseWan26Intent(params.preferredRemoteToolName);
  if (explicitToolIntent) {
    return explicitToolIntent;
  }

  const taskId = readString(params.arguments.task_id) ?? readString(params.arguments.taskId);
  const prompt = readString(params.arguments.prompt);
  if (taskId && !prompt) {
    return "task_status";
  }

  const fragments: string[] = [];
  collectStrings(params.arguments, fragments);
  const joined = fragments.join(" ");
  const hasVideo = WAN26_VIDEO_WORDS.test(joined);
  const hasImage = WAN26_IMAGE_WORDS.test(joined);
  const hasStatus = WAN26_STATUS_WORDS.test(joined);
  if (hasStatus && !hasImage && !hasVideo) {
    return "task_status";
  }
  if (hasVideo && !hasImage) {
    return "video";
  }
  if (hasImage && !hasVideo) {
    return "image";
  }
  if (hasVideo) {
    return "video";
  }
  return "image";
}

export function selectWan26RemoteToolName(params: {
  availableNames: string[];
  preferredRemoteToolName?: string;
  intent: Wan26Intent;
}): string | undefined {
  const explicit = resolveExplicitRemoteToolName(params.availableNames, params.preferredRemoteToolName);
  if (explicit) {
    return explicit;
  }

  const hints = WAN26_INTENT_HINTS[params.intent];
  let bestName: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const name of params.availableNames) {
    const score = scoreByHint(name, hints.include, hints.avoid);
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }
  if (bestName && bestScore > 0) {
    return bestName;
  }
  return undefined;
}

function buildSelectionCacheKey(params: {
  toolId: AliyunMcpToolId;
  selectionArguments?: Record<string, unknown>;
  preferredRemoteToolName?: string;
}): string {
  if (params.toolId !== "wan26Media") {
    return `${params.toolId}:default`;
  }
  const intent = detectWan26Intent({
    arguments: params.selectionArguments ?? {},
    preferredRemoteToolName: params.preferredRemoteToolName,
  });
  const preferred = normalizeName(params.preferredRemoteToolName ?? "");
  return `${params.toolId}:intent=${intent}:preferred=${preferred || "-"}`;
}

function selectRemoteToolName(params: {
  toolId: AliyunMcpToolId;
  availableNames: string[];
  selectionArguments?: Record<string, unknown>;
  preferredRemoteToolName?: string;
}): string {
  const { toolId, availableNames } = params;
  if (availableNames.length === 0) {
    throw new Error("MCP server reported no tools");
  }

  if (toolId === "wan26Media") {
    const wan26Intent = detectWan26Intent({
      arguments: params.selectionArguments ?? {},
      preferredRemoteToolName: params.preferredRemoteToolName,
    });
    const preferred = selectWan26RemoteToolName({
      availableNames,
      intent: wan26Intent,
      preferredRemoteToolName: params.preferredRemoteToolName,
    });
    if (preferred) {
      return preferred;
    }
  }

  const byNormalized = new Map<string, string>();
  for (const name of availableNames) {
    byNormalized.set(normalizeName(name), name);
  }

  const hints = ALIYUN_MCP_REMOTE_TOOL_NAME_HINTS[toolId];
  for (const hint of hints) {
    const exact = byNormalized.get(normalizeName(hint));
    if (exact) {
      return exact;
    }
  }

  for (const hint of hints) {
    const loweredHint = normalizeName(hint);
    const fuzzy = availableNames.find((name) => normalizeName(name).includes(loweredHint));
    if (fuzzy) {
      return fuzzy;
    }
  }

  if (availableNames.length === 1) {
    return availableNames[0];
  }

  throw new Error(
    `Unable to map remote tool for ${toolId}. Available tools: ${availableNames.join(", ")}`,
  );
}

async function connectMcpClient(params: {
  endpoint: string;
  apiKey: string;
  logger?: LoggerLike;
  timeoutSeconds: number;
}): Promise<CachedMcpClient> {
  const endpoint = normalizeEndpoint(params.endpoint);
  const url = new URL(endpoint);
  const timeoutMs = Math.max(1, Math.floor(params.timeoutSeconds * 1000));
  const connectTimeoutMs = Math.min(timeoutMs, ALIYUN_MCP_CONNECT_TIMEOUT_SECONDS * 1000);
  const headers = {
    Authorization: `Bearer ${params.apiKey}`,
    "X-DashScope-DataInspection": "disable",
  };
  const createClient = () =>
    new Client({
      name: "clawdbot-dingtalk-mcp-bridge",
      version: "0.1.0",
    });

  const tryStreamable = async (): Promise<CachedMcpClient> => {
    const client = createClient();
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });
    await withTimeout(client.connect(transport), connectTimeoutMs, "MCP streamable connect");
    return {
      client,
      transport,
      endpoint,
      protocol: "streamable-http",
      resolvedToolNames: {},
      availableToolNames: [],
    };
  };

  const trySse = async (): Promise<CachedMcpClient> => {
    const client = createClient();
    const transport = new SSEClientTransport(url, {
      requestInit: { headers },
    });
    await withTimeout(client.connect(transport), connectTimeoutMs, "MCP SSE connect");
    return {
      client,
      transport,
      endpoint,
      protocol: "sse",
      resolvedToolNames: {},
      availableToolNames: [],
    };
  };

  try {
    return await tryStreamable();
  } catch (error) {
    params.logger?.warn?.(
      `[dingtalk][aliyun-mcp] Streamable HTTP connect failed for ${endpoint}. Falling back to SSE. ${String(error)}`,
    );
  }
  return await trySse();
}

async function closeClient(bundle: CachedMcpClient): Promise<void> {
  try {
    await bundle.transport.close();
  } catch {
    // ignore
  }
}

async function getOrCreateMcpClient(params: {
  endpoint: string;
  apiKey: string;
  logger?: LoggerLike;
  timeoutSeconds: number;
}): Promise<CachedMcpClient> {
  const key = buildClientCacheKey(params.endpoint, params.apiKey);
  const cached = clientCache.get(key);
  if (cached) {
    return cached;
  }

  const connecting = connectingCache.get(key);
  if (connecting) {
    return await connecting;
  }

  const pending = connectMcpClient(params)
    .then((connected) => {
      clientCache.set(key, connected);
      return connected;
    })
    .finally(() => {
      connectingCache.delete(key);
    });

  connectingCache.set(key, pending);
  return await pending;
}

async function resolveRemoteToolName(params: {
  bundle: CachedMcpClient;
  toolId: AliyunMcpToolId;
  timeoutSeconds: number;
  selectionArguments?: Record<string, unknown>;
  preferredRemoteToolName?: string;
}): Promise<string> {
  const selectionKey = buildSelectionCacheKey({
    toolId: params.toolId,
    selectionArguments: params.selectionArguments,
    preferredRemoteToolName: params.preferredRemoteToolName,
  });
  const existing = params.bundle.resolvedToolNames[selectionKey];
  if (existing) {
    return existing;
  }

  const timeoutMs = Math.max(1, Math.floor(params.timeoutSeconds * 1000));
  const listResult = await withTimeout(
    params.bundle.client.listTools(),
    timeoutMs,
    "MCP listTools",
  );
  const availableNames = (listResult.tools ?? [])
    .map((tool) => (typeof tool.name === "string" ? tool.name.trim() : ""))
    .filter(Boolean);
  params.bundle.availableToolNames = availableNames;
  const selected = selectRemoteToolName({
    toolId: params.toolId,
    availableNames,
    selectionArguments: params.selectionArguments,
    preferredRemoteToolName: params.preferredRemoteToolName,
  });
  params.bundle.resolvedToolNames[selectionKey] = selected;
  return selected;
}

async function evictBrokenClient(params: { endpoint: string; apiKey: string }): Promise<void> {
  const key = buildClientCacheKey(params.endpoint, params.apiKey);
  const cached = clientCache.get(key);
  if (cached) {
    await closeClient(cached);
    clientCache.delete(key);
  }
}

export type McpToolInvokeResponse = {
  endpoint: string;
  protocol: McpProtocol;
  remoteToolName: string;
  availableToolNames: string[];
  result: unknown;
};

export async function invokeAliyunMcpTool(params: {
  toolId: AliyunMcpToolId;
  endpoint: string;
  apiKey: string;
  timeoutSeconds: number;
  arguments: Record<string, unknown>;
  selectionArguments?: Record<string, unknown>;
  preferredRemoteToolName?: string;
  logger?: LoggerLike;
}): Promise<McpToolInvokeResponse> {
  const bundle = await getOrCreateMcpClient({
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    logger: params.logger,
    timeoutSeconds: params.timeoutSeconds,
  });
  const timeoutMs = Math.max(1, Math.floor(params.timeoutSeconds * 1000));
  try {
    const remoteToolName = await resolveRemoteToolName({
      bundle,
      toolId: params.toolId,
      timeoutSeconds: params.timeoutSeconds,
      selectionArguments: params.selectionArguments ?? params.arguments,
      preferredRemoteToolName: params.preferredRemoteToolName,
    });
    const result = await withTimeout(
      bundle.client.callTool(
        {
          name: remoteToolName,
          arguments: params.arguments,
        },
        CallToolResultSchema,
      ),
      timeoutMs,
      `MCP callTool(${remoteToolName})`,
    );
    return {
      endpoint: bundle.endpoint,
      protocol: bundle.protocol,
      remoteToolName,
      availableToolNames: bundle.availableToolNames,
      result,
    };
  } catch (error) {
    params.logger?.warn?.(
      `[dingtalk][aliyun-mcp] MCP call failed (${params.toolId}, ${params.endpoint}). Evicting cached client. ${String(error)}`,
    );
    await evictBrokenClient({ endpoint: params.endpoint, apiKey: params.apiKey });
    throw error;
  }
}

export async function resetAliyunMcpClientCache(): Promise<void> {
  const clients = Array.from(clientCache.values());
  clientCache.clear();
  connectingCache.clear();
  for (const client of clients) {
    await closeClient(client);
  }
}
