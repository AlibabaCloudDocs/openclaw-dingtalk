/**
 * DashScope 思考模式模型注册表
 * 定义支持 enable_thinking 参数的模型列表
 */

/**
 * 默认支持思考模式的模型集合
 */
export const DEFAULT_THINKING_MODELS = new Set([
    // Qwen 系列
    "qwen3-max",
    "qwen-plus",
    "qwen-plus-latest",
    "qwen-flash",
    // QwQ 系列
    "qwq-plus",
    // 其他支持思考的模型
    "glm-4.7",
    "deepseek-v3.2",
]);

/**
 * 创建思考模式检查器
 * @param configModels - 逗号分隔的模型列表（可选，覆盖默认）
 * @returns 检查函数
 */
export function createThinkingChecker(
    configModels?: string
): (modelId: string) => boolean {
    let models = DEFAULT_THINKING_MODELS;

    if (configModels?.trim()) {
        const customModels = configModels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (customModels.length > 0) {
            models = new Set(customModels);
        }
    }

    return function supportsThinking(modelId: string): boolean {
        if (!modelId) return false;
        if (models.has(modelId)) return true;
        for (const m of models) {
            if (modelId.startsWith(`${m}-`)) return true;
        }
        return false;
    };
}
