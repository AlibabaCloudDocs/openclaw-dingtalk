# clawdbot-dashscope-proxy

DashScope thinking proxy plugin for OpenClaw.

This plugin runs a local HTTP proxy that forwards OpenAI-compatible requests to DashScope and injects `enable_thinking` / `thinking_budget` for supported models.

## Install

```bash
npm install -g clawdbot-dashscope-proxy --legacy-peer-deps
```

## Configure

Enable the plugin and configure it under `plugins.entries.clawdbot-dashscope-proxy.config`:

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
          "thinkingModels": "qwen-plus,qwen-plus-latest,qwen-flash,qwq-plus"
        }
      }
    }
  }
}
```

Then, point your DashScope provider `baseUrl` to the local proxy:

```json
{
  "models": {
    "providers": {
      "dashscope": {
        "baseUrl": "http://127.0.0.1:18788/v1",
        "apiKey": "sk-xxx"
      }
    }
  }
}
```

This proxy **passes through the incoming `Authorization` header** to DashScope.

## Start Gateway

```bash
openclaw gateway
```
