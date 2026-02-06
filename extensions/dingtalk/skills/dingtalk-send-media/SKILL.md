---
name: dingtalk-send-media
description: Use when chatting via DingTalk and the user asks to “发送/发给我/给我” an image/file/attachment (PDF/Word/Excel/etc), or when needing to output [DING:IMAGE]/[DING:FILE] tags to send local files.
---

# DingTalk Send Media (图片/文件发送)

## Overview

在钉钉渠道中，**要把图片/文件真正发给用户**，必须在回复里输出媒体标签；系统会识别标签、上传本地文件，并把媒体发送给用户。

## When to Use

使用本 skill 的触发场景：

- 用户明确要你“**发送/发给我/给我**”图片、报告、PDF、Word、Excel、压缩包等
- 你需要交付生成物（图表、截图、导出的报表、日志文件等），且用户希望以**媒体/附件**形式收到

不适用（直接用普通文本即可）：

- 用户只想“在聊天里看内容”，不需要附件

## Quick Start (Copy/Paste)

### Send an image

```
[DING:IMAGE path="/absolute/path/to/image.png"]
```

### Send a file

```
[DING:FILE path="/absolute/path/to/file.pdf" name="用户看到的文件名.pdf"]
```

Notes:
- 标签格式**非常严格**，建议直接复制 Quick Start 模板，不要手写拼标签
- `path` **必须写成 `path="..."`（双引号）**，且是绝对路径，文件必须已存在于本地磁盘
- `path` **只允许本地绝对路径**；`http/https` 远程地址不能直接放进标签
- 如果拿到的是远程图片 URL（例如万相返回链接），必须先下载到本地（如 `/tmp/...png`），再输出 `[DING:IMAGE path="/tmp/...png"]`
- `name` 可选；不填则使用原始文件名（主要用于文件显示名；图片也可作为标题/alt）
- 标签内**不要**省略 `path=` / 用单引号 / 不加引号 / 在 `]` 前加空格 / 把标签拆行，否则会被当作普通文本发出
- 标签可放在回复任意位置；发送时会被自动移除（用户只看到文字 + 媒体/附件）
- **不要转义路径**：直接写磁盘上的原始路径（不要写 `\ `、不要写 `%20`）

## Workflow

1. **先确保文件落盘**
   - 已存在：直接进入第 2 步
   - 需要生成/导出：先把文件写到磁盘（如 `/tmp/...` 或项目目录下的某个绝对路径）
   - 如果只有远程 URL：先下载到本地临时文件（推荐 `/tmp/...`），再继续
2. **检查基本约束**
   - 路径是绝对路径（不要用 `~`、相对路径）
   - 文件大小 **≤ 20MB**
3. **在回复正文里输出标签**
   - 图片用 `[DING:IMAGE ...]`
   - 文件用 `[DING:FILE ...]`
4. **可一次发多个**
   - 同一条回复里放多个标签即可；系统会依次处理发送

## Examples

### Example: 图表 + 报告一起发

```
销售趋势图已生成，请查收：
[DING:IMAGE path="/tmp/sales_trend_2026-02-04.png"]

明细数据报告也已导出：
[DING:FILE path="/tmp/sales_detail_report.xlsx" name="销售明细报告.xlsx"]
```

### Example: 只发一个 PDF

```
PDF 已生成完毕，请查收：
[DING:FILE path="/tmp/annual_report.pdf" name="2024年度报告.pdf"]
```

## Constraints (DingTalk Channel)

- **路径**：必须是本机可访问的文件路径，优先使用 Unix 风格绝对路径（`/tmp/...`）
- **图片格式**：png, jpg, jpeg, gif, webp, bmp
- **文件类型**：常见文件类型均可（PDF/Word/Excel/代码文件等）
- **大小限制**：20MB（图片/文件都适用）

## Common Mistakes (Do NOT Do This)
- **标签格式写错（会导致“解析失败/原样发出”）**：
  - `[DING:IMAGE /tmp/test.png]`（缺少 `path="..."`）
  - `[DING:IMAGE path=/tmp/test.png]`（缺少双引号）
  - `[DING:IMAGE path='/tmp/test.png']`（单引号）
  - `[DING:IMAGE path="/tmp/test.png" ]`（` ]` 前多了空格）
- **只说“已发送/已附上”但不输出标签** → 用户收不到任何媒体
- **说“我无法直接发送图片/文件”** → 在钉钉渠道应改用媒体标签发送
- **只输出 `[[reply_to_current]]` 或其他控制标签** → 用户收不到文件
- **用 Markdown 图片语法**：`![alt](/tmp/a.png)` → 不会触发钉钉媒体发送
- **用 `~` 或相对路径**：`path="~/Downloads/a.pdf"` / `path="a.pdf"` → 可能找不到文件
- **在路径里做转义/编码**：`path="/tmp/my%20report.pdf"` / `path="/tmp/my\ report.pdf"` → 不要这样写（直接写原始路径）
- **路径写错或文件没落盘** → 上传失败（用户会收到错误提示）
- **把远程 URL 直接塞进标签**：
  - `[DING:IMAGE https://example.com/a.png]`
  - `[DING:IMAGE path="https://example.com/a.png"]`
  这会导致解析失败或原样回显；必须先下载到本地后再发

## Reference (Implementation)

- Media system prompt: `extensions/dingtalk/src/system-prompt.ts`
- Tag parser: `extensions/dingtalk/src/media-protocol.ts`
