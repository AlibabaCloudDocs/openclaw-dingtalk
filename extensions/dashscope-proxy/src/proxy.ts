/**
 * DashScope 代理服务
 * 为 DashScope API 请求注入 enable_thinking 参数
 */

import http from "node:http";
import type { DashScopeProxyConfig, ProxyLogger, ProxyHandle } from "./types.js";
import { createThinkingChecker } from "./thinking-models.js";

function sanitizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
}

function headerValue(value: string | string[] | undefined): string | undefined {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.length > 0) return value[0];
    return undefined;
}

/**
 * 创建 DashScope 代理服务
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
    const sanitizedTarget = sanitizeBaseUrl(targetBaseUrl);

    const server = http.createServer(async (req, res) => {
        if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
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

            if (thinkingEnabled && supportsThinking(model)) {
                body.enable_thinking = true;
                if (thinkingBudget && thinkingBudget > 0) {
                    body.thinking_budget = thinkingBudget;
                }
                logger.debug(
                    { model, enable_thinking: true, thinking_budget: thinkingBudget || "unlimited" },
                    "Injected thinking parameters"
                );
            }

            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                Authorization: authorization,
            };

            if (req.headers["x-request-id"]) {
                headers["X-Request-Id"] = headerValue(req.headers["x-request-id"]) ?? "";
            }

            const targetFullUrl = `${sanitizedTarget}/chat/completions`;

            logger.info(
                {
                    model,
                    stream: isStream,
                    target: targetFullUrl,
                    enable_thinking: body.enable_thinking,
                    thinking_budget: body.thinking_budget,
                },
                "Proxying request to DashScope"
            );

            if (logRequestBody) {
                logger.debug(
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
                if (key.toLowerCase() === "transfer-encoding") continue;
                if (key.toLowerCase() === "content-encoding") continue;
                responseHeaders[key] = value;
            }

            res.writeHead(response.status, responseHeaders);

            if (isStream && response.body) {
                const reader = response.body.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        res.write(value);
                    }
                } finally {
                    reader.releaseLock();
                    res.end();
                }
            } else {
                const data = await response.arrayBuffer();
                res.end(Buffer.from(data));
            }
        } catch (err) {
            logger.error({ err: { message: (err as Error)?.message } }, "Proxy error");
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
            logger.error({ err: { message: err?.message } }, "Proxy server error");
            reject(err);
        });

        server.listen(port, bind, () => {
            logger.info(
                { port, bind, target: sanitizedTarget, thinkingEnabled },
                "DashScope proxy started"
            );
            resolve({
                server,
                stop: () =>
                    new Promise((res) => {
                        server.close(() => {
                            logger.info({}, "DashScope proxy stopped");
                            res();
                        });
                    }),
            });
        });
    });
}
