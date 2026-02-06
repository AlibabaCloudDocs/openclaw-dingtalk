import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { dingtalkPlugin } from "./src/channel.js";
import { DINGTALK_PLUGIN_ID } from "./src/config-schema.js";
import { createAliyunMcpRegistrations } from "./src/mcp/tools.js";
import { setDingTalkRuntime } from "./src/runtime.js";

const plugin: any = {
  id: DINGTALK_PLUGIN_ID,
  name: "DingTalk",
  description: "DingTalk (钉钉) channel plugin for enterprise messaging",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setDingTalkRuntime(api.runtime);
    api.registerChannel({ plugin: dingtalkPlugin });

    const mcpRegistration = createAliyunMcpRegistrations({
      pluginConfig: api.pluginConfig,
      clawConfig: api.config,
      logger: api.logger,
    });
    for (const warning of mcpRegistration.warnings) {
      api.logger.warn(warning);
    }
    for (const registration of mcpRegistration.tools) {
      api.registerTool(registration.factory, { name: registration.name });
      api.logger.info(`[dingtalk][aliyun-mcp] Registered tool: ${registration.name}`);
    }
  },
};

export default plugin;
