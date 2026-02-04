# AGENTS.md - Openclaw DingTalk Integration (Plugin Version)

> AI Agent guidelines for working in this repository.

## Project Overview

This repository contains deployment configurations and bridge services for integrating **Openclaw** (AI agent gateway) with **DingTalk** (Chinese enterprise messaging). The default setup is the **plugin (npm) version** — install Openclaw first, then install the plugin.

- `build/` - **Legacy image-based** Docker build context (not needed for plugin installs)
- `deploy/` - **Legacy image-based** Docker Compose deployment (not needed for plugin installs)
- `docs/` - Platform-specific integration guides (DingTalk, WeChat, Feishu)
- `openclaw/` - **Symlink** to Openclaw source repo (for reference only, not tracked)

## Versioning & Release

- **Default Publish**: Always publish as `beta` tag by default (`npm publish`).
- **Beta Version Format**: Use semantic versioning with beta suffix, e.g., `0.1.15-beta.0`, `0.1.15-beta.1`.
- **Latest Release**: Only publish `latest` tag when explicitly requested (`npm run release:latest`).

## Build & Run Commands

### Plugin Install (Recommended)

```bash
# 1) Install Openclaw
npm install -g openclaw --legacy-peer-deps

# 2) Install DingTalk plugin
npm install -g clawdbot-dingtalk --legacy-peer-deps

# 3) Configure
vim ~/.openclaw/openclaw.json

# 4) Start gateway
openclaw gateway
```

Minimal config example (`~/.openclaw/openclaw.json`):

```json
{
  "extensions": ["clawdbot-dingtalk"],
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET"
    }
  }
}
```

## Testing

**No test framework is currently configured.** When adding tests:

- Recommend: Vitest or Node.js built-in test runner
- Test files: `*.test.js` or `*.spec.js` in `src/__tests__/`

## Linting & Formatting

**No linter/formatter configured.** When adding:

- Recommend: ESLint flat config + Prettier
- Run manually: `npx eslint src/` or configure scripts

## Code Style Guidelines

### Language & Runtime

- **Node.js 22+** required (see `engines` in package.json)
- **ES Modules** exclusively (`"type": "module"`)
- **JavaScript only** (no TypeScript) - use JSDoc for type hints

### Imports

```javascript
// ✅ Always include .js extension
import { loadConfig } from "./config.js";
import { createLogger } from "../logger.js";

// ✅ Named exports preferred
export function createFoo() {}
export const BAR = "bar";

// ✅ External packages - no extension
import axios from "axios";
import WebSocket from "ws";
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `session-store.js` |
| Functions | camelCase | `createSessionStore()` |
| Factory functions | `create*` prefix | `createLogger()`, `createOpenclawOpenAIClient()` |
| Constants | UPPER_SNAKE | `PROTOCOL_VERSION` |
| Classes | PascalCase | (not commonly used in this codebase) |
| Env vars | UPPER_SNAKE with prefix | `DINGTALK_CLIENT_ID`, `OPENCLAW_MODEL` |

### Function Patterns

```javascript
// ✅ Factory pattern for stateful modules
export function createSessionStore({ maxSessions = 500 } = {}) {
  // private state
  const cache = new LRUCache({ max: maxSessions });
  
  // return public interface
  return { get, set, ensure, reset };
}

// ✅ Configuration loading with defaults
function getEnv(name, { required = false, defaultValue = undefined } = {}) {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (required && defaultValue === undefined) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return defaultValue;
  }
  return v;
}
```

### Error Handling

```javascript
// ✅ Graceful error extraction with fallbacks
catch (err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  logger?.error?.({ err: { message: err?.message, status, data } }, "Call failed");
}

// ✅ Safe property access with optional chaining
const content = resp?.data?.choices?.[0]?.message?.content ?? "";

// ❌ Never swallow errors silently in business logic
catch (err) {} // Only acceptable for truly optional operations
```

### Logging

Use **pino** logger with structured logging:

```javascript
// ✅ Structured logging with context object first
logger.info({ sessionKey, model }, "Calling API");
logger.error({ err: { message: err?.message } }, "Handler error");

// ✅ Use log levels appropriately
logger.debug(...)  // Verbose debugging
logger.info(...)   // Normal operations
logger.warn(...)   // Recoverable issues
logger.error(...)  // Failures
```

### Defensive Programming

This codebase handles external APIs with varying/unstable schemas. Follow these patterns:

```javascript
// ✅ Multi-path field extraction for unstable APIs
function first(obj, paths) {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const sessionWebhook = first(data, [
  "sessionWebhook",
  "session_webhook", 
  "conversationSessionWebhook",
]);

// ✅ Safe string conversion
function asString(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return String(v);
}
```

### Async Patterns

```javascript
// ✅ Async/await with proper error boundaries
async function main() {
  try {
    await startService();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

// ✅ Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, stopping...");
  client.stop();
  process.exit(0);
});
```

## Project-Specific Conventions

### Environment Variables

- All config via `.env` files (never commit secrets)
- See `.env.example` for full list
- Required vars throw on startup if missing
- Use `parseCsv()` for comma-separated lists
- Use `parseIntEnv()` for numeric values with validation

### DingTalk Integration

- Stream mode for receiving messages (WebSocket-based)
- sessionWebhook for sending replies
- Support both text and markdown reply modes
- Message chunking for long responses (max 1800 chars default)

### Openclaw Integration

- Two modes: HTTP (`openai.js`) and WebSocket (`websocket.js`)
- OpenAI-compatible `/v1/chat/completions` endpoint
- Session management via `x-openclaw-session-key` header
- LRU cache for conversation history (500 sessions, 24h TTL)

## File Organization

```
build/
  # Legacy image-based build (not used for plugin installs)
deploy/
  # Legacy image-based deployment (not used for plugin installs)
docs/                 # Platform guides
```

## Security Notes

- Never commit `.env` files (only `.env.example`)
- Gateway binds to 127.0.0.1 only (access via SSH tunnel)
- Use `DINGTALK_ALLOW_FROM` to restrict users
- Use `DINGTALK_REQUIRE_PREFIX` to prevent accidental triggers in groups

## Openclaw Reference (`openclaw/`)

This is a **symlink** to the main Openclaw source repository (not tracked in git). Use it for:

- Understanding Openclaw Gateway internals
- Debugging integration issues
- Referencing API/protocol details

### Key Differences from This Repo

| Aspect | This Repo (dingtalk-bridge) | openclaw |
|--------|----------------------------|--------------|
| Language | JavaScript (ES Modules) | TypeScript (ESM) |
| Package Manager | npm | pnpm |
| Test Framework | None configured | Vitest |
| Linter | None configured | Oxlint + Oxfmt |
| Runtime | Node.js 22+ | Node.js 22+ / Bun |

### Openclaw Source Structure (Reference)

```
openclaw/
  src/           # Core TypeScript source
  extensions/    # Channel plugins (msteams, matrix, zalo, etc.)
  docs/          # Mintlify documentation
  apps/          # iOS, Android, macOS apps
  skills/        # Built-in agent skills
  test/          # Test files (colocated *.test.ts)
```

### Openclaw Commands (Reference)

```bash
# In openclaw directory
pnpm install          # Install deps
pnpm build            # TypeScript compile
pnpm lint             # Oxlint check
pnpm test             # Vitest tests
pnpm openclaw ...     # Run CLI in dev mode
```

### When to Use openclaw

- **DO**: Read source to understand Gateway WS protocol, OpenAI HTTP API behavior
- **DO**: Reference patterns when implementing new Openclaw client features
- **DON'T**: Edit files in openclaw from this repo context
- **DON'T**: Commit changes to openclaw via this repo

## Remote Debug Server

A remote server is available for testing and debugging deployments.

### Connection Details

| Property | Value |
|----------|-------|
| Host | `120.27.224.240` |
| User | `root` |
| SSH Key | `~/.ssh/id_ed25519` |
| Deploy Dir | `/opt/openclaw-dingtalk` |

### Quick Connect

```bash
# Connect to remote server
ssh -i ~/.ssh/id_ed25519 root@120.27.224.240

# Or if key is in default location
ssh root@120.27.224.240
```

### Common Operations (Plugin Version)

```bash
# Install Openclaw + plugin
ssh root@120.27.224.240 "npm install -g openclaw clawdbot-dingtalk --legacy-peer-deps"

# Edit config
ssh root@120.27.224.240 "vim ~/.openclaw/openclaw.json"

# Start gateway (use systemd/pm2 if configured)
ssh root@120.27.224.240 "openclaw gateway"
```

### Test Container

服务器上已拉取测试镜像，用于启动测试容器：

| Property | Value |
|----------|-------|
| Image | `alibaba-cloud-linux-3-registry.cn-hangzhou.cr.aliyuncs.com/alinux3/alinux3` |
| Persist Dir | `~/openclaw-container` |

```bash
# 启动测试容器（持久化目录挂载）
docker run -d --name openclaw-test \
  --memory 2g \
  -v ~/openclaw-container:/data \
  alibaba-cloud-linux-3-registry.cn-hangzhou.cr.aliyuncs.com/alinux3/alinux3 \
  sleep infinity

# 进入容器
docker exec -it openclaw-test bash

# 停止并删除容器
docker stop openclaw-test && docker rm openclaw-test
```

### Notes

- Gateway binds to `127.0.0.1` only — use SSH tunnel for console access
- Ensure `.env` is configured on server before starting containers
- Check `docker compose logs` for startup errors
- 测试容器数据持久化在 `~/openclaw-container` 目录
