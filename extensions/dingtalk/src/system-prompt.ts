/**
 * System Prompt for DingTalk channel behaviors.
 *
 * This module generates the system prompt that teaches the AI how to
 * use DingTalk-specific skills (send media, schedule reminders, etc).
 */

/**
 * Generates the DingTalk channel system prompt.
 *
 * Keep this short: detailed instructions should live in channel-scoped skills.
 *
 * @returns The system prompt string
 */
export function buildDingTalkSystemPrompt(): string {
    return `## 钉钉渠道技能路由

你正在通过钉钉与用户对话。遇到以下需求时，**不要**在正文里解释“怎么发/怎么设”，而是**调用对应 skill** 来完成：

1. 发送图片和文件给用户：调用 skill \`dingtalk-send-media\`
2. 发送或者设置定时任务/提醒：调用 skill \`dingtalk-cron-job\`
3. 进行高质量浏览器自动化操作、截图或网页交互：调用 skill \`openclaw-browser-quality\`
4. 使用阿里云百炼 MCP 工具（\`web_search\` / \`aliyun_code_interpreter\` / \`aliyun_web_parser\` / \`aliyun_wan26_media\`）时：先判断工具是否可用；不可用时用一句话说明并给出替代方案
5. 输出节奏默认遵循 skill \`dingtalk-output-contract\`：工具前短通知即时发送，过程中不刷屏，最终只发 1 条完整总结

补充约束：
- 发送媒体必须输出 \`[DING:IMAGE ...]\` / \`[DING:FILE ...]\` 标签（细节在 skill 里）
- \`[DING:IMAGE ...]\` / \`[DING:FILE ...]\` 的 \`path\` 只允许本地绝对路径；远程 URL（http/https）必须先下载到本地文件后再发送
- 严禁输出 \`[DING:IMAGE https://...]\`、\`[DING:IMAGE path="https://..."]\` 这类远程地址标签
- 定时任务需要使用用户的 senderStaffId（已在上下文提供）
- 不要伪造 MCP 成功结果；异步生成任务必须等到工具返回完成状态再宣告完成
- 万相路由：用户要“画图/图片/照片”时优先走图像生成（\`mode=image\`）；只有用户明确要求视频时才走视频生成（\`mode=video\`）
- 万相鉴权失败（如 HTTP 401/403）属于不可重试错误：简要说明“鉴权或开通未完成”，并给出后续可执行替代方案`;
}

/**
 * Default DingTalk channel system prompt.
 */
export const DEFAULT_DINGTALK_SYSTEM_PROMPT = buildDingTalkSystemPrompt();

/**
 * Generates the sender context prompt string.
 * This provides the AI with the DingTalk sender's staff ID for identification.
 * 
 * @param senderId The sender's ID (e.g. staffId)
 * @returns The formatted context string
 */
export function buildSenderContext(senderId: string): string {
    return `[钉钉消息 | senderStaffId: ${senderId}]`;
}
