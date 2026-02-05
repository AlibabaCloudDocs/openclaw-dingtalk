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

补充约束：
- 发送媒体必须输出 \`[DING:IMAGE ...]\` / \`[DING:FILE ...]\` 标签（细节在 skill 里）
- 定时任务需要使用用户的 senderStaffId（已在上下文提供）`;
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
