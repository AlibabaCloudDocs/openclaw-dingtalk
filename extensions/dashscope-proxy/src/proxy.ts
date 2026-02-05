/**
 * DashScope local proxy - injects enable_thinking based on OpenClaw /think level.
 */

import http from "node:http";
import type { DashScopeProxyConfig, ProxyHandle, ProxyLogger, ThinkLevel } from "./types.js";
import { createThinkingChecker } from "./thinking-models.js";
import { normalizeBaseUrl } from "./provider.js";

const THINKING_RE = /\bthinking\s*=\s*(off|minimal|low|medium|high|xhigh)\b/i;
const REASONING_TAG_OPEN = "<thinking>";
const REASONING_TAG_CLOSE = "</thinking>";

function sanitizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
}

function headerValue(value: string | string[] | undefined): string | undefined {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.length > 0) return value[0];
    return undefined;
}

function normalizeThinkLevel(raw?: string | null): ThinkLevel | undefined {
    if (!raw) return undefined;
    const key = raw.toLowerCase();
    if (["off"].includes(key)) return "off";
    if (["on", "enable", "enabled"].includes(key)) return "low";
    if (["min", "minimal"].includes(key)) return "minimal";
    if (["low"].includes(key)) return "low";
    if (["mid", "med", "medium"].includes(key)) return "medium";
    if (["high", "ultra", "max"].includes(key)) return "high";
    if (["xhigh", "x-high", "x_high"].includes(key)) return "xhigh";
    return undefined;
}

function extractTextFragments(content: unknown): string[] {
    if (typeof content === "string") {
        return [content];
    }
    if (Array.isArray(content)) {
        return content.flatMap((entry) => extractTextFragments(entry));
    }
    if (content && typeof content === "object") {
        const record = content as Record<string, unknown>;
        const text = record.text ?? record.content;
        if (typeof text === "string") {
            return [text];
        }
    }
    return [];
}

function extractThinkLevelFromText(text: string): ThinkLevel | undefined {
    const match = text.match(THINKING_RE);
    if (!match) return undefined;
    return normalizeThinkLevel(match[1]);
}

function resolveThinkLevel(body: Record<string, unknown>): ThinkLevel | undefined {
    const direct =
        normalizeThinkLevel(body.thinking as string | undefined) ??
        normalizeThinkLevel(body.thinking_level as string | undefined) ??
        normalizeThinkLevel(body.thinkingLevel as string | undefined);
    if (direct) return direct;

    const system = body.system;
    if (typeof system === "string") {
        const fromSystem = extractThinkLevelFromText(system);
        if (fromSystem) return fromSystem;
    }

    const prompt = body.prompt;
    if (typeof prompt === "string") {
        const fromPrompt = extractThinkLevelFromText(prompt);
        if (fromPrompt) return fromPrompt;
    }

    const messages = body.messages;
    if (Array.isArray(messages)) {
        for (const msg of messages) {
            if (!msg || typeof msg !== "object") continue;
            const content = (msg as Record<string, unknown>).content;
            const fragments = extractTextFragments(content);
            for (const fragment of fragments) {
                const level = extractThinkLevelFromText(fragment);
                if (level) return level;
            }
        }
    }

    return undefined;
}

function wrapReasoning(text: string): string {
    return `${REASONING_TAG_OPEN}${text}${REASONING_TAG_CLOSE}`;
}

function rewriteReasoningFields(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const record = payload as Record<string, unknown>;
    const choices = record.choices;
    if (!Array.isArray(choices)) return false;
    let changed = false;
    for (const choice of choices) {
        if (!choice || typeof choice !== "object") continue;
        const entry = choice as Record<string, unknown>;

        if (entry.delta && typeof entry.delta === "object") {
            const delta = entry.delta as Record<string, unknown>;
            const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
            if (reasoning) {
                const existing = typeof delta.content === "string" ? delta.content : "";
                delta.content = existing
                    ? `${existing}\n${wrapReasoning(reasoning)}`
                    : wrapReasoning(reasoning);
                delete delta.reasoning_content;
                changed = true;
            }
        }

        if (entry.message && typeof entry.message === "object") {
            const message = entry.message as Record<string, unknown>;
            const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
            if (reasoning) {
                const existing = typeof message.content === "string" ? message.content : "";
                message.content = existing
                    ? `${wrapReasoning(reasoning)}\n${existing}`
                    : wrapReasoning(reasoning);
                delete message.reasoning_content;
                changed = true;
            }
        }
    }
    return changed;
}

function transformSseEvent(event: string): string {
    if (!event.trim()) return event;
    const lines = event.split("\n");
    let changed = false;
    const out = lines.map((line) => {
        const match = line.match(/^data:\s?(.*)$/);
        if (!match) return line;
        const raw = match[1] ?? "";
        if (!raw || raw.trim() === "[DONE]") return line;
        try {
            const payload = JSON.parse(raw);
            if (rewriteReasoningFields(payload)) {
                changed = true;
                return `data: ${JSON.stringify(payload)}`;
            }
        } catch {
            return line;
        }
        return line;
    });
    return changed ? out.join("\n") : event;
}

async function pipeStreamWithTransforms(
    response: Response,
    res: http.ServerResponse,
): Promise<void> {
    if (!response.body) {
        res.end();
        return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const normalized = buffer.replace(/\r\n/g, "\n");
            let idx = normalized.indexOf("\n\n");
            let lastIndex = 0;
            while (idx !== -1) {
                const event = normalized.slice(lastIndex, idx);
                const transformed = transformSseEvent(event);
                res.write(encoder.encode(`${transformed}\n\n`));
                lastIndex = idx + 2;
                idx = normalized.indexOf("\n\n", lastIndex);
            }
            buffer = normalized.slice(lastIndex);
        }
    } finally {
        reader.releaseLock();
    }
    if (buffer.length > 0) {
        const transformed = transformSseEvent(buffer.replace(/\r\n/g, "\n"));
        res.write(encoder.encode(`${transformed}\n\n`));
    }
    res.end();
}

function buildForwardHeaders(req: http.IncomingMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (!value) continue;
        const lower = key.toLowerCase();
        if (lower === "host" || lower === "content-length") continue;
        if (Array.isArray(value)) {
            headers[key] = value.join(",");
        } else {
            headers[key] = value;
        }
    }
    headers["Content-Type"] = "application/json";
    return headers;
}

function resolveTargetUrl(targetBaseUrl: string, reqUrl: string | undefined): string {
    const base = normalizeBaseUrl(targetBaseUrl);
    if (!reqUrl) return base;
    const url = new URL(reqUrl, "http://localhost");
    const path = url.pathname || "/";
    const normalizedPath =
        path === "/v1"
            ? ""
            : path.startsWith("/v1/")
                ? path.slice(3)
                : path;
    return `${sanitizeBaseUrl(base)}${normalizedPath}${url.search}`;
}

/**
 * Create DashScope local proxy server.
 */
export async function createDashScopeProxy(
    config: DashScopeProxyConfig,
    logger: ProxyLogger
): Promise<ProxyHandle> {
    const {
        port,
        bind,
        targetBaseUrl,
        thinkingEnabled,
        thinkingBudget,
        thinkingModels,
        logRequestBody,
    } = config;

    if (!targetBaseUrl) {
        throw new Error("DashScope targetBaseUrl is required");
    }

    const supportsThinking = createThinkingChecker(thinkingModels);

    const server = http.createServer(async (req, res) => {
        if (req.method !== "POST") {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }

        const authorization = headerValue(req.headers.authorization);
        if (!authorization) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing Authorization header" }));
            return;
        }

        try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                chunks.push(chunk as Buffer);
            }
            const bodyBuffer = Buffer.concat(chunks);

            let body: Record<string, unknown>;
            try {
                body = JSON.parse(bodyBuffer.toString("utf-8")) as Record<string, unknown>;
            } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid JSON body" }));
                return;
            }

            const model = (body.model as string) || "";
            const isStream = body.stream === true;
            const path = req.url ?? "";
            const shouldCheckThinking = path.includes("/chat/completions");

            const thinkLevel = shouldCheckThinking ? resolveThinkLevel(body) : undefined;
            const supportsModel = supportsThinking(model);
            const requestedThinking = body.enable_thinking === true;
            const shouldEnable =
                thinkingEnabled &&
                supportsModel &&
                (requestedThinking || (thinkLevel !== undefined && thinkLevel !== "off"));

            if (shouldEnable) {
                body.enable_thinking = true;
                if (thinkingBudget && thinkingBudget > 0) {
                    body.thinking_budget = thinkingBudget;
                }
            } else if (!requestedThinking) {
                delete body.enable_thinking;
                delete body.thinking_budget;
            }

            const headers = buildForwardHeaders(req);
            headers.Authorization = authorization;

            if (req.headers["x-request-id"]) {
                headers["X-Request-Id"] = headerValue(req.headers["x-request-id"]) ?? "";
            }

            const targetFullUrl = resolveTargetUrl(targetBaseUrl, req.url);

            logger.info?.(
                {
                    model,
                    stream: isStream,
                    target: targetFullUrl,
                    thinkLevel: thinkLevel ?? "unknown",
                    enable_thinking: body.enable_thinking === true,
                    thinking_budget: body.thinking_budget ?? null,
                },
                "Proxying request to DashScope"
            );

            if (logRequestBody) {
                logger.debug?.(
                    { requestBody: JSON.stringify(body).slice(0, 2000) },
                    "Full request body"
                );
            }

            const response = await fetch(targetFullUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            });

            const responseHeaders: Record<string, string> = {};
            for (const [key, value] of response.headers) {
                const lower = key.toLowerCase();
                if (lower === "transfer-encoding" || lower === "content-encoding") continue;
                responseHeaders[key] = value;
            }

            res.writeHead(response.status, responseHeaders);

            if (isStream && response.body) {
                await pipeStreamWithTransforms(response, res);
            } else {
                const data = await response.arrayBuffer();
                try {
                    const text = Buffer.from(data).toString("utf-8");
                    const parsed = JSON.parse(text);
                    if (rewriteReasoningFields(parsed)) {
                        res.end(JSON.stringify(parsed));
                        return;
                    }
                } catch {
                    // fall through: send raw body
                }
                res.end(Buffer.from(data));
            }
        } catch (err) {
            logger.error?.({ err: { message: (err as Error)?.message } }, "Proxy error");
            if (!res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        error: "Proxy error",
                        message: (err as Error)?.message,
                    })
                );
            } else {
                res.end();
            }
        }
    });

    return new Promise<ProxyHandle>((resolve, reject) => {
        server.on("error", (err) => {
            logger.error?.({ err: { message: err?.message } }, "Proxy server error");
            reject(err);
        });

        server.listen(port, bind, () => {
            logger.info?.(
                { port, bind, target: sanitizeBaseUrl(targetBaseUrl), thinkingEnabled },
                "DashScope proxy started"
            );
            resolve({
                stop: () =>
                    new Promise((res) => {
                        server.close(() => {
                            logger.info?.({}, "DashScope proxy stopped");
                            res();
                        });
                    }),
            });
        });
    });
}
