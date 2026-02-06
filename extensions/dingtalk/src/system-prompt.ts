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

补充约束：
- 发送媒体必须输出 \`[DING:IMAGE ...]\` / \`[DING:FILE ...]\` 标签（细节在 skill 里）
- 定时任务需要使用用户的 senderStaffId（已在上下文提供）
- 不要伪造 MCP 成功结果；异步生成任务必须等到工具返回完成状态再宣告完成`;
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
