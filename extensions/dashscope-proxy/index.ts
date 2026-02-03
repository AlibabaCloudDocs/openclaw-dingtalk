import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { createDashScopeProxyService } from "./src/service.js";

const plugin = {
    id: "clawdbot-dashscope-proxy",
    name: "DashScope Proxy",
    description: "DashScope thinking proxy plugin for OpenClaw",
    register(api: OpenClawPluginApi) {
        api.registerService(
            createDashScopeProxyService({
                pluginConfig: api.pluginConfig as Record<string, unknown> | undefined,
            })
        );
    },
};

export default plugin;
