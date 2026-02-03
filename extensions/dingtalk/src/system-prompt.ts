/**
 * System Prompt for DingTalk Media Protocol.
 *
 * This module generates the system prompt that teaches the AI how to
 * send media files (images, files, videos, audio) to the user via DingTalk.
 */

/**
 * Generates the media protocol system prompt.
 * This prompt instructs the AI to use specific tags when it wants to send media.
 *
 * @param options Configuration options
 * @returns The system prompt string
 */
export function buildMediaSystemPrompt(options: {
    enableImages?: boolean;
    enableFiles?: boolean;
    enableVideos?: boolean;
    enableAudio?: boolean;
} = {}): string {
    const {
        enableImages = true,
        enableFiles = true,
        enableVideos = true,
        enableAudio = true,
    } = options;

    const sections: string[] = [];

    sections.push(`## 钉钉媒体发送协议

你正在通过钉钉与用户对话。当你需要发送**图片、文件、视频或音频**给用户时，必须使用以下特定格式的标签。系统会自动识别这些标签，上传文件到钉钉服务器，并以独立消息的形式发送给用户。

**⚠️ 关键规则：**
- 当用户要求你"发送"、"发给我"、"给我"某个文件时，你**必须**使用下面的标签格式
- **不要只输出 [[reply_to_current]] 或其他控制标签**，那样用户什么都收不到
- 如果文件已存在，直接使用标签发送；如果需要先读取，读取后也要使用标签发送

**核心原则：**
- 所有媒体都必须已经存在于本地磁盘上（你需要先生成/保存它）
- 使用以下标签格式，系统会自动处理上传和发送
- 标签可以放在回复中的任意位置，发送时会被自动移除
- 用户会看到：你的文字回复 + 独立的媒体消息`);

    if (enableImages) {
        sections.push(`
### 图片发送

当你需要向用户发送图片时，使用以下格式：

\`\`\`
[DING:IMAGE path="/absolute/path/to/image.png"]
\`\`\`

**示例：**
\`\`\`
这是我为您生成的图表：
[DING:IMAGE path="/tmp/chart_2024.png"]

如果您需要修改，请告诉我。
\`\`\`

**注意事项：**
- \`path\` 必须是**绝对路径**
- 支持格式：png, jpg, jpeg, gif, webp, bmp
- 文件大小限制：20MB
- 不要使用 Markdown 图片语法 \`![alt](path)\`，那不会触发图片发送`);
    }

    if (enableFiles) {
        sections.push(`
### 文件发送

当你需要向用户发送文件（PDF、Word、Excel、代码文件等）时，使用以下格式：

\`\`\`
[DING:FILE path="/absolute/path/to/file.pdf" name="显示的文件名.pdf"]
\`\`\`

**参数说明：**
- \`path\` (必需): 文件的绝对路径
- \`name\` (可选): 用户看到的文件名，默认使用原始文件名

**示例：**
\`\`\`
报告已生成完毕，请查收：
[DING:FILE path="/tmp/annual_report.pdf" name="2024年度报告.pdf"]
\`\`\`

**注意事项：**
- 文件大小限制：20MB
- 支持所有常见文件类型`);
    }

    if (enableVideos) {
        sections.push(`
### 视频发送

当你需要向用户发送视频时，使用以下格式：

\`\`\`
[DING:VIDEO path="/absolute/path/to/video.mp4"]
\`\`\`

**示例：**
\`\`\`
这是您要的演示视频：
[DING:VIDEO path="/tmp/demo.mp4"]
\`\`\`

**注意事项：**
- 支持格式：mp4
- 文件大小限制：20MB
- 系统会自动提取视频封面`);
    }

    if (enableAudio) {
        sections.push(`
### 音频发送

当你需要向用户发送音频或语音文件时，使用以下格式：

\`\`\`
[DING:AUDIO path="/absolute/path/to/audio.mp3"]
\`\`\`

**示例：**
\`\`\`
这是生成的语音播报：
[DING:AUDIO path="/tmp/tts_output.mp3"]
\`\`\`

**注意事项：**
- 支持格式：mp3, wav, ogg, amr
- 文件大小限制：20MB`);
    }

    sections.push(`
### 重要提醒

1. **路径必须正确**: 只使用你确定存在的文件路径
2. **先保存再发送**: 如果需要生成文件（如代码、报告），先保存到磁盘，再使用标签发送
3. **不要转义路径**: 不要对路径使用反斜杠转义，直接写原始路径
4. **一次可发多个**: 可以在同一条回复中包含多个标签，它们会被依次发送
5. **发送失败提示**: 如果文件过大或不存在，用户会收到错误提示

**错误示例 ❌：**
- \`![图片](/tmp/image.png)\` - 这是 Markdown 语法，不会触发发送
- \`path="~/Downloads/file.txt"\` - 不要使用 ~ 符号
- \`path="file.txt"\` - 必须使用绝对路径

**正确示例 ✅：**
- \`[DING:IMAGE path="/tmp/screenshot.png"]\`
- \`[DING:FILE path="/var/data/report.pdf" name="报告.pdf"]\``);

    return sections.join("\n");
}

/**
 * Default system prompt with all media types enabled.
 */
export const DEFAULT_MEDIA_SYSTEM_PROMPT = buildMediaSystemPrompt();
