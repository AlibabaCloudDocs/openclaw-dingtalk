# clawdbot-dashscope-proxy

DashScope provider plugin for OpenClaw (native thinking, no proxy).

This plugin registers a DashScope provider and uses OpenClaw’s native `/think` command to enable
thinking mode for supported Qwen models. No local HTTP proxy is required.

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

```json
{
  "models": {
    "providers": {
      "dashscope": {
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
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

If you previously used the local proxy:

- Remove any proxy base URL such as `http://127.0.0.1:18788/v1`.
- Use the direct DashScope base URL instead.
- You can delete old `plugins.entries.clawdbot-dashscope-proxy` proxy config.

## Start Gateway

```bash
openclaw gateway
```
