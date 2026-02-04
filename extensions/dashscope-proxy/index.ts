import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { createDashScopeProvider } from "./src/provider.js";

const plugin = {
    id: "clawdbot-dashscope-proxy",
    name: "DashScope",
    description: "DashScope provider plugin for OpenClaw (native thinking)",
    register(api: OpenClawPluginApi) {
        api.registerProvider(createDashScopeProvider());
    },
};

export default plugin;
