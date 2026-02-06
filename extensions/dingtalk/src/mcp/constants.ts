export type AliyunMcpToolId = "webSearch" | "codeInterpreter" | "webParser" | "wan26Media";

export const ALIYUN_MCP_DEFAULT_TIMEOUT_SECONDS = 60;
export const ALIYUN_MCP_CONNECT_TIMEOUT_SECONDS = 20;

export const ALIYUN_MCP_DEFAULT_ENDPOINTS: Record<AliyunMcpToolId, string> = {
  webSearch: "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/sse",
  codeInterpreter: "https://dashscope.aliyuncs.com/api/v1/mcps/code_interpreter_mcp/mcp",
  webParser: "https://dashscope.aliyuncs.com/api/v1/mcps/WebParser/sse",
  wan26Media: "https://dashscope.aliyuncs.com/api/v1/mcps/Wan26Media/sse",
};

export const ALIYUN_MCP_PLUGIN_TOOL_NAMES: Record<AliyunMcpToolId, string> = {
  webSearch: "web_search",
  codeInterpreter: "aliyun_code_interpreter",
  webParser: "aliyun_web_parser",
  wan26Media: "aliyun_wan26_media",
};

export const ALIYUN_MCP_API_KEY_ENV_GLOBAL = "DASHSCOPE_API_KEY";

export const ALIYUN_MCP_API_KEY_ENV_BY_TOOL: Record<AliyunMcpToolId, string[]> = {
  webSearch: ["DASHSCOPE_MCP_WEBSEARCH_API_KEY", "DASHSCOPE_MCP_WEB_SEARCH_API_KEY"],
  codeInterpreter: [
    "DASHSCOPE_MCP_CODEINTERPRETER_API_KEY",
    "DASHSCOPE_MCP_CODE_INTERPRETER_API_KEY",
  ],
  webParser: ["DASHSCOPE_MCP_WEBPARSER_API_KEY", "DASHSCOPE_MCP_WEB_PARSER_API_KEY"],
  wan26Media: ["DASHSCOPE_MCP_WAN26MEDIA_API_KEY", "DASHSCOPE_MCP_WAN26_MEDIA_API_KEY"],
};

export const ALIYUN_MCP_REMOTE_TOOL_NAME_HINTS: Record<AliyunMcpToolId, string[]> = {
  webSearch: ["web_search", "web-search", "websearch", "search_web"],
  codeInterpreter: [
    "code_interpreter",
    "code-interpreter",
    "python",
    "python_interpreter",
    "run_code",
  ],
  webParser: ["web_parser", "web-parser", "webparser", "parse_web", "web_parse"],
  wan26Media: [
    "modelstudio_wanx26_image_generation",
    "wanx26_image_generation",
    "text_to_image",
    "image_generation",
    "wan26_media",
    "wanx",
    "media_generate",
  ],
};
