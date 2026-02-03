# Clawdbot Cheat Sheet

这份速查表涵盖了 Clawdbot 核心 CLI 命令以及钉钉插件的常用功能。

## 📦 核心管理 (Core Management)

| 命令 | 说明 | 示例 |
|---|---|---|
| `clawdbot setup` | 初始化配置和 Agent 工作区 | `clawdbot setup` |
| `clawdbot onboard` | 交互式向导，快速设置网关和 Skill | `clawdbot onboard` |
| `clawdbot configure` | 配置凭证、设备和 Agent 默认值 | `clawdbot configure` |
| `clawdbot config set <key> <val>` | 设置配置项 | `clawdbot config set gateway.port 18888` |
| `clawdbot doctor` | 检查网关和频道的健康状态 | `clawdbot doctor` |
| `clawdbot dashboard` | 打开 Web 控制面板 | `clawdbot dashboard` |

## 🌐 网关控制 (Gateway)

| 命令 | 说明 | 示例 |
|---|---|---|
| `clawdbot gateway` | 在前台启动网关 (WebSocket) | `clawdbot gateway --port 18789` |
| `clawdbot gateway start` | 作为后台服务启动 (需 install) | `clawdbot gateway start` |
| `clawdbot gateway status` | 查看网关服务状态 | `clawdbot gateway status` |
| `clawdbot gateway logs` | 查看网关日志 | `clawdbot gateway logs` |
| `clawdbot gateway --dev` | 开发模式启动 (隔离环境) | `clawdbot --dev gateway` |

## 🧩 插件与频道 (Plugins & Channels)

| 命令 | 说明 | 示例 |
|---|---|---|
| `clawdbot plugins list` | 列出已安装的插件 | `clawdbot plugins list` |
| `clawdbot plugins install <pkg>` | 安装插件 (npm包名或路径) | `clawdbot plugins install clawdbot-dingtalk` |
| `clawdbot channels list` | 列出配置的频道及认证信息 | `clawdbot channels list` |
| `clawdbot channels status` | 查看频道连接状态 | `clawdbot channels status` |
| `clawdbot step channels login` | 登录频道 (如 WhatsApp/Telegram) | `clawdbot channels login` |

## 💬 消息与 Agent (Message & Agent)

| 命令 | 说明 | 示例 |
|---|---|---|
| `clawdbot message send` | 发送消息 | `clawdbot message send --target +86138... --message "Hello"` |
| `clawdbot agent` | 直接调用 Agent 进行对话 | `clawdbot agent --message "Build a plan" --deliver` |
| `clawdbot sessions` | 列出当前的会话列表 | `clawdbot sessions` |

## 🤖 钉钉插件专用 (DingTalk)

### 配置文件 (`~/.clawdbot/clawdbot.json`)
```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "...",
      "clientSecret": "..."
    }
  }
}
```

### 聊天指令 (Chat Commands)
在钉钉聊天窗口中直接发送：

| 指令 | 说明 | 示例 |
|---|---|---|
| `/new` | 重置当前会话上下文 | `/new` |
| `/think <level>` | 设置思考深度 (off/minimal/low/medium/high) | `/think high` |
| `/model <id>` | 切换当前会话的模型 | `/model openai/gpt-4o` |
| `/models` | 列出可用模型提供商 | `/models` |
| `/verbose <on/off>` | 切换详细日志显示 (工具调用过程) | `/verbose on` |

> **注意**: 在钉钉群聊中，如果配置了 `requirePrefix`，指令也需要加上相应的前缀。

## 🗑️ 卸载与重置 (Uninstall & Reset)

### 卸载插件

| 命令 | 说明 | 示例 |
|---|---|---|
| `clawdbot plugins disable <id>` | 禁用插件 (保留文件) | `clawdbot plugins disable clawdbot-dingtalk` |
| `npm uninstall -g <pkg>` | 卸载全局安装的插件 | `npm uninstall -g clawdbot-dingtalk` |

### 重置配置/状态

| 命令 | 说明 | 示例 |
|---|---|---|
| `clawdbot reset` | 交互式重置 (选择范围) | `clawdbot reset` |
| `clawdbot reset --scope config` | 仅重置配置文件 | `clawdbot reset --scope config --yes` |
| `clawdbot reset --scope full` | 完全重置 (配置+凭证+会话) | `clawdbot reset --scope full --yes` |
| `clawdbot reset --dry-run` | 预览将被删除的内容 | `clawdbot reset --dry-run` |

### 卸载网关服务

| 命令 | 说明 | 示例 |
|---|---|---|
| `clawdbot gateway uninstall` | 卸载系统服务 (launchd/systemd) | `clawdbot gateway uninstall` |
| `clawdbot uninstall` | 卸载网关服务+本地数据 (CLI 保留) | `clawdbot uninstall` |

### 完全卸载 Clawdbot

```bash
# 1. 停止并卸载服务
clawdbot gateway stop
clawdbot uninstall

# 2. 卸载 CLI 和全局插件
npm uninstall -g clawdbot clawdbot-dingtalk

# 3. (可选) 清理残留配置目录
rm -rf ~/.clawdbot
```

> **提示**: 使用 `--dry-run` 参数可以在执行删除前预览将被清理的内容。
