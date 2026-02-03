import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDashScopeProxy } from "./proxy.js";

type Captured = {
    headers: http.IncomingHttpHeaders;
    bodyText: string;
    url?: string;
};

function listen(server: http.Server): Promise<{ port: number; bind: string }> {
    return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("failed to resolve server address"));
                return;
            }
            resolve({ port: address.port, bind: "127.0.0.1" });
        });
    });
}

describe("DashScope proxy (integration)", () => {
    const captured: Captured[] = [];
    let upstream: http.Server;
    let upstreamBaseUrl = "";

    let proxyHandle: Awaited<ReturnType<typeof createDashScopeProxy>> | null = null;
    let proxyBaseUrl = "";

    const logger = {
        info: () => { },
        debug: () => { },
        warn: () => { },
        error: () => { },
    };

    beforeAll(async () => {
        upstream = http.createServer(async (req, res) => {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                chunks.push(chunk as Buffer);
            }
            const bodyText = Buffer.concat(chunks).toString("utf-8");
            captured.push({ headers: req.headers, bodyText, url: req.url });

            if (req.url?.includes("/chat/completions") && req.method === "POST") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "not found" }));
        });

        const upstreamListen = await listen(upstream);
        upstreamBaseUrl = `http://${upstreamListen.bind}:${upstreamListen.port}`;

        proxyHandle = await createDashScopeProxy(
            {
                enabled: true,
                port: 0,
                bind: "127.0.0.1",
                targetBaseUrl: upstreamBaseUrl,
                thinkingEnabled: true,
                thinkingBudget: 123,
                thinkingModels: "qwen-plus",
            },
            logger
        );

        const addr = proxyHandle.server.address();
        if (!addr || typeof addr === "string") {
            throw new Error("failed to resolve proxy server address");
        }
        proxyBaseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await proxyHandle?.stop();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });

    it("injects thinking parameters and passes through Authorization", async () => {
        captured.length = 0;

        const resp = await fetch(`${proxyBaseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer sk-test",
            },
            body: JSON.stringify({
                model: "qwen-plus",
                stream: false,
                messages: [{ role: "user", content: "hi" }],
            }),
        });

        expect(resp.status).toBe(200);
        expect(captured.length).toBe(1);

        const req = captured[0];
        expect(req.url).toContain("/chat/completions");
        expect(req.headers.authorization).toBe("Bearer sk-test");

        const body = JSON.parse(req.bodyText) as Record<string, unknown>;
        expect(body.enable_thinking).toBe(true);
        expect(body.thinking_budget).toBe(123);
    });

    it("returns 401 when Authorization header is missing", async () => {
        const resp = await fetch(`${proxyBaseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "qwen-plus", stream: false, messages: [] }),
        });

        expect(resp.status).toBe(401);
        const data = (await resp.json()) as Record<string, unknown>;
        expect(data.error).toBeTruthy();
    });
});
