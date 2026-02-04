---
name: dingtalk-cron-job
description: "钉钉渠道专用定时提醒技能。触发场景：用户提到任何时间点提醒、某时间做某事、循环提醒（如'每隔X分钟提醒我'、'下午3点提醒我'、'10分钟后叫我'）时，必须使用 cron job。"
metadata: {"openclaw": {"always": true}}
---

# 钉钉定时提醒

当用户提到任何与**时间点提醒**相关的内容时，必须使用 `clawdbot cron add` 创建定时任务。

## 触发场景

以下情况**必须**使用 cron job：
- "X点提醒我..."
- "X分钟/小时后提醒我..."
- "每隔X时间提醒我一次..."
- "明天/后天X点..."
- 任何涉及定时、延时、循环提醒的请求

## 命令模板

```bash
clawdbot cron add \
  --name "<根据对话生成的任务名>" \
  --at "<时间>+08:00" \
  --session isolated \
  --message "提醒用户：<具体提醒内容>" \
  --channel "clawdbot-dingtalk" \
  --to "<用户的senderStaffId>"
```

## 参数规则（必须严格遵守）

| 参数 | 规则 | 说明 |
|------|------|------|
| `--name` | 根据对话自动生成 | 简短描述任务，如"站立活动提醒"、"会议提醒" |
| `--at` | **必须带 `+08:00`** | 北京时间，格式：`2026-02-02T14:30:00+08:00` |
| `--cron` | 循环任务用此参数 | 配合 `--tz "Asia/Shanghai"` 使用 |
| `--session` | **必须是 `isolated`** | 不可用 main，否则消息可能丢失 |
| `--message` | **必须用"提醒用户/发送给用户"句式** | 见下方详细说明 |
| `--channel` | **必须是 `clawdbot-dingtalk`** | 钉钉渠道固定值 |
| `--to` | 用户的 senderStaffId | 从对话上下文获取，不是手机号 |

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
clawdbot cron add \
  --name "开会提醒" \
  --at "2026-02-02T15:00:00+08:00" \
  --session isolated \
  --message "提醒用户：下午3点的会议马上开始了，请准备参会。" \
  --channel "clawdbot-dingtalk" \
  --to "02482523065424091871"
```

### 一次性提醒（相对时间）

用户说："20分钟后提醒我喝水"

```bash
clawdbot cron add \
  --name "喝水提醒" \
  --at "+20m" \
  --session isolated \
  --message "提醒用户：该喝水了！保持水分很重要。" \
  --channel "clawdbot-dingtalk" \
  --to "02482523065424091871" \
  --delete-after-run
```

### 循环提醒

用户说："每2小时提醒我休息一下"

```bash
clawdbot cron add \
  --name "定时休息提醒" \
  --cron "0 */2 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "提醒用户：已经过去2小时了，该休息一下眼睛和身体。" \
  --channel "clawdbot-dingtalk" \
  --to "02482523065424091871"
```

### 每日固定时间提醒

用户说："每天早上9点提醒我看日报"

```bash
clawdbot cron add \
  --name "日报提醒" \
  --cron "0 9 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "提醒用户：早上好！该查看今日日报了。" \
  --channel "clawdbot-dingtalk" \
  --to "02482523065424091871"
```

## 常见错误检查清单

创建任务前确认：

- [ ] 时间带了 `+08:00` 或使用了 `--tz "Asia/Shanghai"`
- [ ] `--session isolated` 不是 main
- [ ] `--message` 用了"提醒用户"句式
- [ ] `--channel` 是 `clawdbot-dingtalk`
- [ ] `--to` 是正确的 senderStaffId

## 调试命令

```bash
# 查看所有任务
clawdbot cron list

# 立即测试任务
clawdbot cron run <job-id>

# 删除任务
clawdbot cron rm <job-id>
```
