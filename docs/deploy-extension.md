# Clawdbot + DingTalk 部署指南 (Extension 模式)

本文档介绍如何使用纯 npm 方式部署 Clawdbot + 钉钉插件，无需 Docker。

## 快速开始

### 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/aliyun/tech-solution-clawdbot-extension/main/install.sh | bash
```

### 手动安装

```bash
# 1. 安装 Clawdbot
npm install -g clawdbot --legacy-peer-deps

# 2. 安装钉钉插件
npm install -g clawdbot-dingtalk --legacy-peer-deps

# 3. 编辑配置
vim ~/.clawdbot/clawdbot.json

# 4. 启动
clawdbot gateway
```

## 配置文件

编辑 `~/.clawdbot/clawdbot.json`:

> Plugin ID：`dingtalk`（用于 `plugins.allow` / `plugins.entries`）  
> NPM 包名：`clawdbot-dingtalk`

```json
{
  "extensions": ["clawdbot-dingtalk"],
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "你的钉钉 Client ID",
      "clientSecret": "你的钉钉 Client Secret"
    }
  },
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

提示：DashScope 思考模式使用 OpenClaw 原生 `/think` 指令开启，无需代理。

## 生产环境部署

### 方式一：systemd (推荐)

创建服务文件 `/etc/systemd/system/clawdbot.service`:

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

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable clawdbot
sudo systemctl start clawdbot

# 查看状态
sudo systemctl status clawdbot

# 查看日志
journalctl -u clawdbot -f
```

### 方式二：PM2

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start "clawdbot gateway" --name clawdbot

# 保存配置
pm2 save

# 设置开机自启
pm2 startup
```

### 方式三：后台运行

```bash
nohup clawdbot gateway > ~/clawdbot.log 2>&1 &
```

## 钉钉配置

1. 登录 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用
3. 开启"机器人"能力
4. 在"凭证与基础信息"获取 Client ID 和 Client Secret
5. 配置机器人消息订阅

## 常用配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `clientId` | string | - | 钉钉 Client ID (必填) |
| `clientSecret` | string | - | 钉钉 Client Secret (必填) |
| `replyMode` | `"text"` / `"markdown"` | `"text"` | 消息格式 |
| `maxChars` | number | `1800` | 单条消息最大字符数 |
| `allowFrom` | string[] | `[]` | 允许的发送者 ID 列表 |
| `requirePrefix` | string | - | 消息前缀要求 |

## 多账户配置

```json
{
  "channels": {
    "dingtalk": {
      "accounts": {
        "support": {
          "enabled": true,
          "clientId": "client-id-1",
          "clientSecret": "secret-1",
          "name": "客服机器人"
        },
        "dev": {
          "enabled": true,
          "clientId": "client-id-2",
          "clientSecret": "secret-2",
          "name": "开发助手"
        }
      }
    }
  }
}
```

## 常用命令

```bash
# 启动服务
clawdbot gateway

# 查看版本
clawdbot --version

# 查看帮助
clawdbot --help
```

## 故障排查

### 查看日志

```bash
# systemd
journalctl -u clawdbot -f

# PM2
pm2 logs clawdbot
```

### 常见问题

1. **连接失败**: 检查 Client ID/Secret 是否正确
2. **无响应**: 检查百炼 API Key 是否有效
3. **消息被截断**: 调整 `maxChars` 参数

## 与 Docker 方式对比

| 项目 | NPM 方式 | Docker 方式 |
|------|----------|-------------|
| 容器数 | 0 | 1 |
| 安装复杂度 | 低 | 中 |
| 环境隔离 | 无 | 有 |
| 更新方式 | `npm update -g` | 拉取新镜像 |
| 适用场景 | 开发/小规模 | 生产/大规模 |
