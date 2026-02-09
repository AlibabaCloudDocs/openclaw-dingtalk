# DingTalk 插件白盒沙盘 (HTML)

目的：把 `extensions/dingtalk/` 插件与 Openclaw 的关键组件、控制流与数据流“摊开”展示，帮助你用可视化 + 可回放场景理解整个系统。

## 如何打开

推荐（最稳定）：

```bash
cd docs/dingtalk-sandbox
python -m http.server
```

然后浏览器打开：

```text
http://localhost:8000/
```

说明：
- `index.html` 内嵌了 `model.json` / `scenarios.json`，理论上 `file://` 也能打开；但不同浏览器的安全策略与剪贴板 API 行为不同，所以仍推荐走本地 HTTP server。

## 你会看到什么

- **导览**：按步骤回放 6 条关键路径（启动、入站 DM、群聊过滤、媒体协议、AI Card、卡片回调），并在图上高亮节点/边与 token 动画。
- **模拟器**：手动改 `chat` 与账号配置，实时计算过滤结果与 `SessionKey`，并展示下一步会走到哪里。
- **代码索引**：按泳道列出节点，点击即可在右侧看到对应的 `rg`/`sed` 定位提示。
- **术语**：把 `sessionWebhook`、`SessionKey`、`deliver(kind)`、`[DING:*]`、AI Card 这些关键抽象讲清楚。

## 文件结构

- `docs/dingtalk-sandbox/index.html`: 主页面（内嵌 JSON，保证可离线打开）
- `docs/dingtalk-sandbox/app.css`: 样式
- `docs/dingtalk-sandbox/app.js`: 逻辑（渲染图、播放场景、模拟器）
- `docs/dingtalk-sandbox/model.json`: 节点/边图谱（可维护的白盒模型）
- `docs/dingtalk-sandbox/scenarios.json`: 导览场景与 step 状态数据

## 数据一致性校验

在仓库根目录运行：

```bash
node scripts/validate-dingtalk-sandbox.mjs
```

它会校验：
- `model.json` 节点/边引用完整
- `scenarios.json` 的 focus 引用存在
- `index.html` 内嵌 JSON 与 `model.json` / `scenarios.json` 一致

