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
  resolvedToolNames: Partial<Record<AliyunMcpToolId, string>>;
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

function selectRemoteToolName(toolId: AliyunMcpToolId, availableNames: string[]): string {
  if (availableNames.length === 0) {
    throw new Error("MCP server reported no tools");
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
}): Promise<string> {
  const existing = params.bundle.resolvedToolNames[params.toolId];
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
  const selected = selectRemoteToolName(params.toolId, availableNames);
  params.bundle.resolvedToolNames[params.toolId] = selected;
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
