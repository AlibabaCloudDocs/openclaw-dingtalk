# Openclaw / Clawdbot 常见问题解答（FAQ）

> 本文档汇总了用户在使用 **Openclaw 网关** + **钉钉插件（`clawdbot-dingtalk`）** 过程中遇到的常见问题及解决方案，目标是让你可以按本文档 **自查、自学、独立排障**。

**先确认你用的是哪套方案（很关键）**：
- **Openclaw 插件版（本文默认）**：`npm install -g openclaw clawdbot-dingtalk --legacy-peer-deps`，钉钉侧使用 **Stream 模式（长连接）**，通常 **不需要回调地址**、也 **不需要开放入站端口**。（可避免安装时触发 `node-llama-cpp`/llama.cpp 的本地编译）
- **旧版 Docker/HTTP 回调方案**：通常会出现 `8081` 端口、`/dingtalk/callback`、`appKey/appSecret/robotCode` 等配置；请优先参考 `docs/01-dingtalk.md`（该文档与本文的配置字段不同）。

---

## 目录

1. [安装问题](#1-安装问题)
2. [机器人不回复](#2-机器人不回复)
3. [模型配置](#3-模型配置)
4. [配置与参数](#4-配置与参数)
5. [功能使用](#5-功能使用)
6. [故障排查](#6-故障排查)
7. [运维与升级](#7-运维与升级)

---

## 快速自查（1 分钟）

如果你只想快速判断“哪里出了问题”，按这个顺序走通常最快：

1. **能不能启动**：`openclaw gateway --log-level debug`（看是否报错退出）
2. **插件是否加载**：`openclaw plugins list`（如你使用的是 `clawdbot` 命令则改为 `clawdbot plugins list`；确认出现 `clawdbot-dingtalk`）
3. **配置是否可解析**：`cat ~/.openclaw/openclaw.json | python3 -m json.tool`
4. **钉钉是否连上**：看日志里是否出现“stream connected / websocket connected”一类关键词
5. **模型是否可用**：看日志里是否出现“model call failed / invalid api key / 403”一类关键词

下面的 FAQ 是把这些步骤展开成“能照着做、能举一反三”的版本。

---

## 1. 安装问题

### Q: 执行 `openclaw` 或 `clawdbot` 提示命令找不到

**解决方案**：

```bash
# 1) 查看 npm 全局安装路径（最后会有 /bin）
npm config get prefix

# 2) 追加到 PATH（macOS 通常改 ~/.zshrc；Linux 常见 ~/.bashrc）
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 3) 验证
command -v openclaw
openclaw --version
```

如果你希望把 npm 全局目录固定到当前用户（避免 sudo/权限问题）：

```bash
mkdir -p ~/.npm-global
npm config set prefix "$HOME/.npm-global"
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

### Q: npm 安装插件时报错

**常见错误及解决**：

| 错误 | 解决方案 |
|------|----------|
| `EACCES: permission denied` | `npm config set prefix "$HOME/.npm-global"` |
| 网络超时 / `ETIMEDOUT` | 切换 registry：`npm config set registry https://registry.npmmirror.com`（或使用公司内网源） |
| `ENOTFOUND` / DNS 问题 | 优先检查服务器 DNS / 代理；必要时换网络或配置 `HTTPS_PROXY` |
| Node.js 版本低 | 建议 Node.js 22+：`node -v` 检查；`nvm install 22 && nvm use 22` |
| `ERR_MODULE_NOT_FOUND` | 通常是 Node 版本过低或全局安装目录混乱；先升级 Node，再重装 |

```bash
# 重新安装
npm install -g openclaw clawdbot-dingtalk --legacy-peer-deps
```

安装后建议做一次“可见性检查”：

```bash
openclaw --version
openclaw plugins list
```

---

### Q: 服务器需要什么配置？

**最低配置（能跑起来）**：
- 1 核 1G 内存（轻度使用），磁盘 10G+
- 稳定的出网访问（至少能访问模型供应商 API 与钉钉）
- Node.js 22+（推荐），npm 可用

**更推荐（更稳）**：2 核 2G 起（例如阿里云 e 实例 2c2g），并开启时间同步（NTP），避免签名/令牌时间偏差导致鉴权异常。

**端口/安全组**：
- 插件版 **Stream 模式**通常 **不需要开放入站端口**（只要出网正常即可）。
- Openclaw Web UI 如使用默认端口（示例中提到的 `18789`），默认一般只绑定 `127.0.0.1`，通过 SSH 隧道访问更安全（见下文）。

---

## 2. 机器人不回复

### Q: 配置完成后，机器人不回复消息

这是最常见的问题，请按以下步骤排查：

**第 1 步：检查服务是否运行**
```bash
ps aux | grep openclaw
# 或查看日志
openclaw gateway --log-level debug
```

**第 2 步：验证配置文件**

检查 `~/.openclaw/openclaw.json`（注意：插件的 channel key 是 `clawdbot-dingtalk`，不是 `dingtalk`）：

```json
{
  "extensions": ["clawdbot-dingtalk"],
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "ding开头的Client ID",
      "clientSecret": "你的Client Secret"
    }
  },
  "models": {
    "providers": {
      "dashscope": {
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "sk-你的百炼API密钥",
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

**常见配置错误**：
- channel key 写成 `dingtalk` 而不是 `clawdbot-dingtalk`
- `clientId` / `clientSecret` 复制错（多空格、换行、粘贴了中文引号）
- 旧文档里的 `appKey/appSecret/robotCode` 与插件版字段混用（插件版只需要 `clientId/clientSecret`）
- JSON 格式错误（缺少逗号或引号）

**第 3 步：检查钉钉应用配置**

| 检查项 | 位置 |
|--------|------|
| 应用已发布 | 版本管理与发布 |
| 机器人已添加 | 添加应用能力 → 机器人 |
| Stream 模式 | 机器人配置 → 消息接收模式（一般无需回调地址） |
| 出口 IP / 网络策略 | 如钉钉侧要求配置“服务器出口 IP”，确保填的是部署机公网出口 |

**第 4 步：确认 Stream 模式**

Openclaw 使用 **Stream 模式**（长连接），**不需要**：
- 填写回调地址
- 开放服务器端口
- 配置 HTTPS

**第 5 步：确认触发条件**

很多“看起来不回复”的情况，其实是机器人 **没有被触发**：
- 群聊里先确认 **已把机器人添加到群**。默认情况下（`requireMention: true`）需要 **@机器人** 才会响应。
- 如果你配置了 `requirePrefix`，则会按“前缀触发”来过滤消息（通常可以不 @），例如：`!帮我总结一下`。
- 如果配置了 `allowFrom`（白名单），只有白名单里的用户才会得到回复（见下文“配置与参数”）。

---

### Q: 一直在转圈圈 / 处理中没有响应

**可能原因及解决**：

| 原因 | 解决方案 |
|------|----------|
| 模型 API 调用失败 | 查看日志：`openclaw gateway --log-level debug` |
| API Key 无效或额度用完 | 检查百炼控制台 API Key 状态 |
| 网络问题 | 测试：`curl -I https://dashscope.aliyuncs.com` |
| 消息太长被分片/被限流 | 先用一句短消息测试（如“你好”），再排查 `maxChars` 与钉钉侧限制 |
| 机器人权限/范围 | 确认应用已发布、可见范围包含当前用户/群；必要时重新发布版本 |

---

## 3. 模型配置

### Q: 如何切换/更换大模型？

**方法 1：在钉钉对话中使用命令**
```
/model dashscope/qwen-max
/models dashscope  # 查看可用模型
```

**方法 2：编辑配置文件**

修改 `~/.openclaw/openclaw.json` 中的 `agents.defaults.model.primary`。

**可用模型**：

| 模型 ID | 说明 |
|---------|------|
| `dashscope/qwen-max` | 通义千问旗舰版 |
| `dashscope/qwen-plus` | 增强版（性价比高） |
| `dashscope/qwen3-coder-plus` | 代码专用 |

---

### Q: 如何使用 OpenAI / Gemini / 其他模型？

**配置示例**：

```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-你的密钥",
        "api": "openai-completions",
        "models": [
          { "id": "gpt-4o", "contextWindow": 128000, "maxTokens": 16384 }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "openai/gpt-4o" }
    }
  }
}
```

**第三方中转**（如 aihubmix）：将 `baseUrl` 改为中转地址即可。

**自查要点（最容易踩坑）**：
- `baseUrl` 是否包含 `/v1`（OpenAI 兼容接口通常需要）
- `apiKey` 是否有前后空格（粘贴时最常见）
- `agents.defaults.model.primary` 必须与 `providers.<name>` 对应：`<provider>/<modelId>`
- `maxTokens` 不是“越大越好”：越大越慢、也可能更贵；先从 2k~8k 试起更稳

---

### Q: 403 Model access denied / API 执行为空

**解决方案**：
1. 登录 [百炼控制台](https://bailian.console.aliyun.com/) → 模型广场 → 申请开通模型
2. 确认 API Key 格式正确（`sk-` 开头，无多余空格）
3. 使用 `dashscope/模型名` 格式（如 `dashscope/qwen-max`）

**补充说明**：
- 403 常见于“模型没开通 / 子账号无权限 / 额度或计费异常”，先从控制台确认权限与计费状态再继续排查。
- “API 执行为空”也可能是网络被拦截或证书问题；建议在服务器上用 `curl -I` 直连测试目标域名。

---

## 4. 配置与参数

### Q: 配置文件在哪？

**最常见路径**：
- Openclaw：`~/.openclaw/openclaw.json`
- 旧版/兼容命令：`~/.clawdbot/clawdbot.json`（如果你本机主要使用的是 `clawdbot` 命令）

不确定用哪个时，可以先检查文件是否存在：

```bash
ls -la ~/.openclaw/openclaw.json 2>/dev/null || true
ls -la ~/.clawdbot/clawdbot.json 2>/dev/null || true
```

下文示例默认使用 `~/.openclaw/openclaw.json`，如果你的环境是 `~/.clawdbot/clawdbot.json`，把路径替换掉即可。

```bash
# 查看配置
cat ~/.openclaw/openclaw.json

# 验证 JSON 格式
cat ~/.openclaw/openclaw.json | python3 -m json.tool
```

**建议（避免改崩）**：修改前先备份一份可回滚的配置

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak.$(date +%Y%m%d-%H%M%S)
```

---

### Q: 启动时报错：Browser 配置里的 `controlURL` 已不支持？

这是 **旧版字段名**（`controlURL` / `controlUrl`），新版 Openclaw 使用 **CDP** 命名：
- 单配置：`browser.cdpUrl`
- 多 Profile：`browser.profiles.<name>.cdpUrl` 或 `browser.profiles.<name>.cdpPort`

**最简单的迁移方式**：把 `controlURL` 改成 `cdpUrl`（值保持不变），并删除旧字段。

示例（单配置）：

```diff
  "browser": {
    "enabled": true,
-   "controlURL": "http://127.0.0.1:18792"
+   "cdpUrl": "http://127.0.0.1:18792"
  }
```

如果你使用的是 profile（推荐）：

```json
{
  "browser": {
    "enabled": true,
    "defaultProfile": "remote",
    "profiles": {
      "remote": { "cdpUrl": "http://10.0.0.42:9222" }
    }
  }
}
```

---

### Q: 不想把 `clientSecret` 明文写进配置怎么办？

可以把密钥放到一个只对当前用户可读的文件里，然后在配置中使用 `clientSecretFile`：

```bash
mkdir -p ~/.openclaw/secrets
printf '%s' 'YOUR_CLIENT_SECRET' > ~/.openclaw/secrets/dingtalk-client-secret.txt
chmod 600 ~/.openclaw/secrets/dingtalk-client-secret.txt
```

```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "YOUR_CLIENT_ID",
      "clientSecretFile": "~/.openclaw/secrets/dingtalk-client-secret.txt"
    }
  }
}
```

如果你的运行环境不支持 `~` 展开，改用绝对路径（例如 `/root/.openclaw/secrets/...`）。

---

### Q: 公网 IP 在哪看？

```bash
# 阿里云 ECS 元数据服务（推荐）
curl -s http://100.100.100.200/latest/meta-data/eipv4 ---------------------------------------------------------------------

# 备选方案
curl -s ifconfig.me
```

---

### Q: 为什么没有 `web_search` / 百炼 MCP 工具？

钉钉插件内置的 4 个百炼 MCP 工具都带独立开关，且默认值是 **全关**：

- `plugins.entries.clawdbot-dingtalk.config.aliyunMcp.tools.webSearch.enabled`
- `plugins.entries.clawdbot-dingtalk.config.aliyunMcp.tools.codeInterpreter.enabled`
- `plugins.entries.clawdbot-dingtalk.config.aliyunMcp.tools.webParser.enabled`
- `plugins.entries.clawdbot-dingtalk.config.aliyunMcp.tools.wan26Media.enabled`

同时，安装器默认会把 `tools.web.search.enabled` 设为 `false`（关闭 core Brave 搜索）。

这意味着：
- 如果你没打开插件里的 `webSearch`，系统就不会有任何 `web_search` 工具。
- 这属于预期行为，不会自动回退 Brave。
- 对话层会采用“先检测再降级”：如果工具不可用，AI 会简短说明后继续给出可执行替代方案，而不是卡住。

可用最小配置示例：

```json
{
  "plugins": {
    "entries": {
      "clawdbot-dingtalk": {
        "enabled": true,
        "config": {
          "aliyunMcp": {
            "timeoutSeconds": 60,
            "tools": {
              "webSearch": { "enabled": true },
              "codeInterpreter": { "enabled": false },
              "webParser": { "enabled": false },
              "wan26Media": { "enabled": false, "autoSendToDingtalk": true }
            }
          }
        }
      }
    }
  },
  "tools": {
    "web": {
      "search": {
        "enabled": false
      }
    }
  }
}
```

API Key 优先级（高 -> 低）：

1. `DASHSCOPE_MCP_<TOOL>_API_KEY`
2. `DASHSCOPE_API_KEY`
3. `plugins.entries.clawdbot-dingtalk.config.aliyunMcp.apiKey`

补充说明：
- `aliyun_web_parser` 更适合公开可访问 URL；登录态页面常见失败。
- `aliyun_wan26_media` 可能是异步流程（提交任务 + 获取结果）；AI 应在最终成功状态后再宣告完成。

---

### Q: 一个人怎么获取钉钉开发者权限？

**个人开发者**：
1. 打开钉钉 App → 我的 → 右上角「+」→ 创建团队（创建个人组织）
2. 用该组织登录 [钉钉开放平台](https://open-dev.dingtalk.com/)

**企业用户**：联系管理员在「管理后台 → 权限管理」中授权。

---

### Q: 钉钉的 `clientId` / `clientSecret` 在哪获取？

在钉钉开放平台获取应用凭证（以“企业内部应用”为例）：

1. 登录钉钉开放平台（通常是 `open-dev.dingtalk.com` / `open.dingtalk.com` 入口）
2. 创建应用（企业内部应用），并在“添加应用能力”里添加 **机器人**
3. 进入应用的「凭证与基础信息」页面
4. 复制 **Client ID** 和 **Client Secret**，填入 `channels.clawdbot-dingtalk.clientId/clientSecret`

自查提示：
- Client ID 往往以 `ding` 开头
- 粘贴到 JSON 时注意不要带多余空格/换行、不要用中文引号

---

### Q: 18789 端口安全问题

Openclaw 默认只监听 `127.0.0.1`，外网无法直接访问。

**访问 Web UI**：通过 SSH 隧道
```bash
ssh -L 18789:localhost:18789 root@服务器IP
# 然后访问 http://localhost:18789
```

**注意**：钉钉插件使用 Stream 模式，**不需要开放任何入站端口**。

---

### Q: 如何限制只有特定的人/群可以用机器人？

插件通常会提供两类“防误触/防滥用”的开关（具体字段以你的插件版本为准；本文给出最常见的配置方式）：

1) **白名单（allowFrom）**：只允许指定用户触发机器人
```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "allowFrom": ["userIdA", "userIdB"]
    }
  }
}
```

2) **前缀触发（requirePrefix）**：群聊中必须以固定前缀开头才响应（防止“随便聊天就触发”）
```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "requirePrefix": "!"
    }
  }
}
```

**关于群聊 @（requireMention）**：
- 插件通常默认 `requireMention: true`（群聊需 @ 机器人）。
- 你可以改成“前缀触发”（上面的 `requirePrefix`），或者显式关闭：

```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "requireMention": false
    }
  }
}
```

也可以只给少数用户免 @（`mentionBypassUsers`）：

```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "mentionBypassUsers": ["userIdA", "userIdB"]
    }
  }
}
```

使用了 `requirePrefix` 后，示例触发方式：
- `!总结一下这段文字`
- `!/model dashscope/qwen-max`（指令也需要带前缀）

---

### Q: 回复太长被截断/分多条发出来怎么办？

钉钉对单条消息长度通常有限制，插件一般会做“自动分片”。你可以通过类似 `maxChars` 的配置控制每条的最大长度（默认经常是 1800 左右）：

```json
{
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "maxChars": 1800
    }
  }
}
```

排查建议：
- 先把问题简化：发一句短消息确认链路 OK，再讨论长文本策略
- 如果你开启了 `replyMode: "markdown"`，注意钉钉对 markdown 也有格式/长度限制（复杂表格与超长代码块更容易出问题）

---

## 5. 功能使用

### Q: 钉钉对话中有哪些命令？

| 命令 | 说明 | 示例 |
|------|------|------|
| `/new` | 重置会话 | `/new` |
| `/model <模型>` | 切换模型 | `/model dashscope/qwen-max` |
| `/models [provider]` | 列出模型 | `/models dashscope` |
| `/think <off|minimal|low|medium|high>` | 思考级别 | `/think medium` |
| `/verbose on\|off\|full` | 非最终消息/工具过程显示 | `/verbose on` |

补充说明：
- 指令通常也支持“行内使用”，例如：`帮我看看 /model openai/gpt-4o`（具体以版本为准）。
- 如果配置了 `allowFrom` / `requirePrefix`，指令同样会受这些规则影响（群聊尤其常见）。

---

## 6. 故障排查

### Q: 服务挂掉了 / UI 打不开

**排查步骤**：

```bash
# 1. 检查进程
ps aux | grep openclaw

# 2. 检查端口
ss -lntp | grep 18789 || netstat -tlnp | grep 18789

# 3. 查看日志
openclaw gateway --log-level debug

# 4. 重启服务
pkill -f openclaw && openclaw gateway
```

**配置改错导致无法启动**：
```bash
# 手动修复配置
nano ~/.openclaw/openclaw.json
```

---

### Q: 如何定位“到底是钉钉没连上，还是模型没调用成功”？

建议用“分层排障”的思路：

1) **网关层（Openclaw）**：先确认进程不退出、配置能解析（JSON 校验通过）
2) **渠道层（DingTalk）**：再确认 Stream/WebSocket 已连接（日志里应出现连接成功关键词）
3) **模型层（LLM Provider）**：最后确认模型调用成功（无 401/403/429 等错误）

在 debug 日志中，优先关注这些信号：
- 渠道连接成功：`stream connected` / `websocket connected`（不同版本关键词略有差异）
- 鉴权失败：`Invalid credentials` / `unauthorized`
- 模型失败：`Model call failed` / `403` / `429` / `timeout`

---

## 快速诊断命令

```bash
# 检查安装
openclaw --version

# 检查插件
openclaw plugins list

# 验证配置
cat ~/.openclaw/openclaw.json | python3 -m json.tool

# 查看日志
openclaw gateway --log-level debug                 ----------------------------------------
```

如果你本机主要使用的是 `clawdbot` 命令，把上述 `openclaw` 替换为 `clawdbot` 即可。

**常见日志关键词**：
- `DingTalk stream connected` → 连接成功
- `Model call failed` → 模型调用失败
- `Invalid credentials` → 凭证错误

---

## 7. 运维与升级

### Q: 如何升级 Openclaw / 钉钉插件？

```bash
npm update -g openclaw clawdbot-dingtalk
openclaw --version
openclaw plugins list
```

如果你遇到“升级后行为异常”，建议先做一次“最小化回滚”：
1) 恢复备份配置（见上文 `openclaw.json.bak...`）
2) 用 `openclaw gateway --log-level debug` 前台启动，先把错误信息跑出来再处理       

---

### Q: 如何把网关长期稳定跑在服务器上？

最稳的方式通常是 **systemd/PM2** 这类进程守护（崩溃自动拉起、日志集中、支持开机自启）。

因为不同发行版路径可能不同，建议你在写 service 前先确认 `openclaw` 的真实路径：

```bash
command -v openclaw
```

如果你希望我顺手把“systemd/PM2 示例”也整理进本 FAQ（并与你们当前脚本/目录结构完全一致），告诉我你服务器的系统类型（Ubuntu/Debian/Alinux 等）即可。

---

*最后更新：2026-02-03*
