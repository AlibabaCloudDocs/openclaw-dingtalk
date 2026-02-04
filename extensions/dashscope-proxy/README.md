# clawdbot-dashscope-proxy

DashScope provider plugin for OpenClaw (local thinking proxy).

DashScope thinking models require `enable_thinking=true`. This plugin starts a lightweight local
proxy that injects `enable_thinking` based on OpenClaw’s `/think` level, while still using the
DashScope OpenAI-compatible API.

## Install

```bash
npm install -g clawdbot-dashscope-proxy --legacy-peer-deps
```

## Configure

### Option A: Auth Wizard (Recommended)

```bash
openclaw auth dashscope
```

Follow the prompts for:

- DashScope API Key
- Base URL (default: `https://dashscope.aliyuncs.com/compatible-mode/v1`)
- Model IDs (comma-separated)

### Option B: Manual Config

1) Enable the proxy service (optional overrides shown):

```json
{
  "plugins": {
    "entries": {
      "clawdbot-dashscope-proxy": {
        "enabled": true,
        "config": {
          "bind": "127.0.0.1",
          "port": 18788,
          "targetBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "thinkingEnabled": true,
          "thinkingBudget": 0,
          "thinkingModels": "qwen3-max-2026-01-23,qwen3-coder-plus"
        }
      }
    }
  }
}
```

2) Point the DashScope provider at the local proxy:

```json
{
  "models": {
    "providers": {
      "dashscope": {
        "baseUrl": "http://127.0.0.1:18788/v1",
        "apiKey": "sk-xxx",
        "api": "openai-completions",
        "models": [
          { "id": "qwen3-max-2026-01-23", "name": "Qwen3 Max Thinking", "contextWindow": 262144, "maxTokens": 32768, "reasoning": true, "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false } },
          { "id": "qwen3-coder-plus", "name": "Qwen3 Coder Plus", "contextWindow": 1000000, "maxTokens": 65536 }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "dashscope/qwen3-coder-plus" },
      "models": {
        "dashscope/qwen3-max-2026-01-23": {},
        "dashscope/qwen3-coder-plus": {}
      }
    }
  }
}
```

## Thinking Mode

Use OpenClaw’s native command to enable thinking per session:

```
/think on
```

## Migration Notes

If you previously used the local proxy, keep the proxy base URL:

- Ensure your provider base URL points to the proxy (`http://127.0.0.1:18788/v1` by default).
- The proxy forwards to DashScope and injects `enable_thinking` when `/think` is not off.

## Start Gateway

```bash
openclaw gateway
```
