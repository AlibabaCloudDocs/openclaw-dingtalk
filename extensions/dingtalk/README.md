# clawdbot-dingtalk

DingTalk (钉钉) channel plugin for [Clawdbot](https://github.com/anthropics/claude-code) - enables AI agent messaging via DingTalk Stream API.

## Installation

```bash
# Install Clawdbot globally
npm install -g clawdbot --legacy-peer-deps

# Install DingTalk plugin
npm install -g clawdbot-dingtalk --legacy-peer-deps
```

> Plugin ID: `clawdbot-dingtalk` (used in `plugins.allow` / `plugins.entries`)  
> NPM package: `clawdbot-dingtalk`

## Configuration

Edit `~/.clawdbot/clawdbot.json`:

```json
{
  "extensions": ["clawdbot-dingtalk"],
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "your-dingtalk-client-id",
      "clientSecret": "your-dingtalk-client-secret"
    }
  },
  "models": {
    "providers": {
      "dashscope": {
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "sk-xxx",
        "api": "openai-completions",
        "models": [
          { "id": "qwen3-coder-plus", "contextWindow": 1000000, "maxTokens": 65536 }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "dashscope/qwen3-coder-plus" }
    }
  }
 }
```

## DashScope Thinking Mode (Native)

DashScope's `enable_thinking` is **natively supported** via the `/think` command. No proxy is needed.

To enable thinking mode for a session:

```
/think on
```

Or use one-shot thinking for a single message:

```
/t! on 请帮我分析这段代码
```

Thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.  
`/think on` maps to `high` (OpenClaw gateway "high").

## Reasoning Visibility (Optional)

Use `/reasoning on` to show model reasoning in replies (rendered as subtle Markdown blockquotes).  
Use `/reasoning off` to hide it.

## Start Gateway

```bash
clawdbot gateway
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the channel |
| `clientId` | string | - | DingTalk app Client ID (required) |
| `clientSecret` | string | - | DingTalk app Client Secret (required) |
| `clientSecretFile` | string | - | Path to file containing client secret |
| `replyMode` | `"text"` \| `"markdown"` | `"text"` | Message format |
| `maxChars` | number | `1800` | Max characters per message chunk |
| `allowFrom` | string[] | `[]` | Allowlist of sender IDs (empty = allow all) |
| `requirePrefix` | string | - | Require messages to start with prefix |
| `isolateContextPerUserInGroup` | boolean | `false` | When enabled, isolate session context per user in group chats |
| `responsePrefix` | string | - | Prefix added to responses |
| `tableMode` | `"code"` \| `"off"` | `"code"` | Table rendering mode |
| `showToolStatus` | boolean | `false` | Show tool execution status |
| `showToolResult` | boolean | `false` | Show tool results |
| `thinking` | string | `"off"` | Thinking mode (off/minimal/low/medium/high) |

## AI Card (高级互动卡片)

Enable AI Card capability via config:

```json
{
  "channels": {
    "clawdbot-dingtalk": {
        "aiCard": {
          "enabled": true,
          "templateId": "your-template-id",
          "autoReply": true,
          "textParamKey": "content",
          "defaultCardData": {
            "title": "Clawdbot"
          },
          "callbackType": "STREAM",
          "updateThrottleMs": 800,
          "fallbackReplyMode": "markdown",
          "openSpace": {
            "imGroupOpenSpaceModel": {
            "openConversationId": "cidxxx"
          }
        }
      }
    }
  }
}
```

Notes:
- `callbackType` should be `STREAM` to receive card callbacks over Stream API.
- `autoReply=true` 会把普通文本回复映射成卡片变量，需要 `textParamKey` 与模板变量名一致。
- If `openSpace` / `openSpaceId` is missing, card delivery falls back to text.

## Chat Commands

The following chat switches are supported in DingTalk:

- `/new` - Reset session context
- `/think [off|minimal|low|medium|high]` - Set thinking level (`/think on` => `high`)
- `/t! [off|minimal|low|medium|high|on] <message>` - One-shot thinking (does not persist)
- `/reasoning [on|off|stream]` - Toggle reasoning visibility
- `/model <provider/model>` - Switch model
- `/models [provider]` - List providers or models under a provider
- `/verbose on|off|full` - Toggle non-final updates (tool/block)

Notes:
- Commands respect `allowFrom` and `requirePrefix` (in group chats).
- Inline usage is supported (e.g., "帮我看看 /model openai/gpt-4o").

### Multi-account Configuration

```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "accounts": {
        "bot1": {
          "enabled": true,
          "clientId": "client-id-1",
          "clientSecret": "secret-1",
          "name": "Support Bot"
        },
        "bot2": {
          "enabled": true,
          "clientId": "client-id-2",
          "clientSecret": "secret-2",
          "name": "Dev Bot"
        }
      }
    }
  }
}
```

### Message Coalescing

Control how streaming messages are batched before sending:

```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "coalesce": {
        "enabled": true,
        "minChars": 800,
        "maxChars": 1200,
        "idleMs": 1000
      }
    }
  }
}
```

## Running as a Service

### Using systemd (Linux)

Create `/etc/systemd/system/clawdbot.service`:

```ini
[Unit]
Description=Clawdbot Gateway
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/clawdbot gateway
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable clawdbot
sudo systemctl start clawdbot
```

### Using PM2

```bash
npm install -g pm2
pm2 start "clawdbot gateway" --name clawdbot
pm2 save
pm2 startup
```

## DingTalk Setup

1. Go to [DingTalk Open Platform](https://open.dingtalk.com/)
2. Create an Enterprise Internal Application
3. Enable "Robot" capability
4. Get Client ID and Client Secret from "Credentials & Basic Info"
5. Configure the robot's messaging subscription

## License

MIT
