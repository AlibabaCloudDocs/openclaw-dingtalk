---
name: dingtalk-cron-job
description: "钉钉渠道专用定时提醒技能。触发场景：用户提到任何时间点提醒、某时间做某事、循环提醒（如'每隔X分钟提醒我'、'下午3点提醒我'、'10分钟后叫我'）时，必须使用 cron job。"
metadata: {"openclaw": {"always": true}}
---

# 钉钉定时提醒

当用户提到任何与**时间点提醒**相关的内容时，必须使用exec直接调用 `openclaw cron add` 创建定时任务。不要用OpenClaw 内置的 cron 工具。

## 触发场景

以下情况**必须**使用 cron job：
- "X点提醒我..."
- "X分钟/小时后提醒我..."
- "每隔X时间提醒我一次..."
- "明天/后天X点..."
- 任何涉及定时、延时、循环提醒的请求

## 命令模板

```bash
openclaw cron add \
  --name "<根据对话生成的任务名>" \
  --at "<时间>" \
  --session isolated \
  --message "提醒用户：<具体提醒内容>" \
  --deliver \
  --channel "clawdbot-dingtalk" \
  --to "<用户的senderStaffId>"
```

## 参数规则（必须严格遵守）

| 参数 | 规则 | 说明 |
|------|------|------|
| `--name` | 根据对话自动生成 | 简短描述任务，如"站立活动提醒"、"会议提醒" |
| `--at` | 绝对时间需带时区 | 绝对时间用 ISO8601 且包含时区偏移或 `Z`，如 `2026-02-02T14:30:00+08:00` / `2026-02-02T06:30:00Z`；相对时间用 `20m` / `2h` 等 |
| `--cron` | 循环任务用此参数 | 配合 `--tz "Asia/Shanghai"` 使用 |
| `--session` | **必须是 `isolated`** | 不可用 main，否则消息可能丢失 |
| `--message` | **必须用"提醒用户/发送给用户"句式** | 见下方详细说明 |
| `--deliver` | **必须开启** | 隔离任务需要显式投递到渠道，否则不会发给用户 |
| `--channel` | **必须是 `clawdbot-dingtalk`** | 钉钉渠道固定值 |
| `--to` | 单聊用 senderStaffId；群聊用 `dingtalk:group:<cid...>` | 群提醒见下方说明 |
| `--delete-after-run` | 一次性提醒建议加 | 避免执行后残留任务 |

## 群聊提醒（本群/提醒所有人）

当用户说“在群里提醒大家/提醒本群”时，用群目标而不是用户 staffId：

- `--to "dingtalk:group:<cid...>"`

示例：

```bash
openclaw cron add \
  --name "群打卡提醒" \
  --cron "0 17 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "提醒用户：该下班打卡啦～" \
  --deliver \
  --channel "clawdbot-dingtalk" \
  --to "dingtalk:group:cidxxxxxxxx"
```

## `--deliver` vs `--announce`（别混淆）

- `--deliver`：是否把隔离任务输出投递到渠道/用户；不投递则只在内部/主会话可见。建议显式写出以避免默认行为误解。
- `--announce`：指“向主会话写一条摘要/公告”，用于追踪与审计，不等于发给用户。隔离任务默认会在主会话留下摘要（带 `Cron` 前缀），可通过 `isolation.postToMainPrefix` 等配置调整摘要行为。

## message 参数关键规则

**核心理解**：message 是发给 Agent 的指令，Agent 处理后回复到用户钉钉。

### 错误写法 ❌
```
--message "起来活动一下"
```
Agent 会误解为让它自己"起来活动"。

### 正确写法 ✅
```
--message "提醒用户：该起来活动一下了！久坐对身体不好，请起身走动几分钟。"
```

### message 句式模板
- `提醒用户：<内容>`
- `发送给用户：<内容>`
- `告诉用户：<内容>`
- `请生成一条关于<主题>的提醒发送给用户`

## 完整示例

### 一次性提醒（指定时间点）

用户说："下午3点提醒我开会"

```bash
openclaw cron add \
  --name "开会提醒" \
  --at "2026-02-02T15:00:00+08:00" \
  --session isolated \
  --message "提醒用户：下午3点的会议马上开始了，请准备参会。" \
  --deliver \
  --channel "clawdbot-dingtalk" \
  --to "02482523065424091871" \
  --delete-after-run
```

### 一次性提醒（相对时间）

用户说："20分钟后提醒我喝水"

```bash
openclaw cron add \
  --name "喝水提醒" \
  --at "20m" \
  --session isolated \
  --message "提醒用户：该喝水了！保持水分很重要。" \
  --deliver \
  --channel "clawdbot-dingtalk" \
  --to "manager9140" \
  --delete-after-run
```

### 循环提醒

用户说："每2小时提醒我休息一下"

```bash
openclaw cron add \
  --name "定时休息提醒" \
  --cron "0 */2 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "提醒用户：已经过去2小时了，该休息一下眼睛和身体。" \
  --deliver \
  --channel "clawdbot-dingtalk" \
  --to "manager9140"
```

### 每日固定时间提醒

用户说："每天早上9点提醒我看日报"

```bash
openclaw cron add \
  --name "日报提醒" \
  --cron "0 9 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "提醒用户：早上好！该查看今日日报了。" \
  --deliver \
  --channel "clawdbot-dingtalk" \
  --to "manager9140"
```

## 常见错误检查清单

创建任务前确认：

- [ ] 绝对时间带时区（或 `--cron` 配合 `--tz "Asia/Shanghai"`）
- [ ] `--session isolated` 不是 main
- [ ] `--message` 用了"提醒用户"句式
- [ ] 使用了 `--deliver`（隔离任务否则不会投递）
- [ ] 全局 `cron.enabled` 未被关闭，且未设置 `OPENCLAW_SKIP_CRON=1`
- [ ] `--channel` 是 `clawdbot-dingtalk`
- [ ] `--to` 是正确的 senderStaffId

## 调试命令

```bash
# 查看所有任务
openclaw cron list

# 立即测试任务
openclaw cron run <job-id>

# 删除任务
openclaw cron rm <job-id>
```
