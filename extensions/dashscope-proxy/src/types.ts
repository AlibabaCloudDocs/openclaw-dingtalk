/**
 * DashScope Proxy 类型定义
 */

import type { Server } from "node:http";

/**
 * DashScope 代理配置
 */
export interface DashScopeProxyConfig {
    /** 是否启用代理 */
    enabled: boolean;
    /** 监听端口 */
    port: number;
    /** 绑定地址 */
    bind: string;
    /** DashScope API 目标 Base URL（不含 /chat/completions） */
    targetBaseUrl: string;
    /** 是否启用思考模式注入 */
    thinkingEnabled: boolean;
    /** 思考预算 (0=无限制) */
    thinkingBudget: number;
    /** 支持思考的模型列表 (逗号分隔) */
    thinkingModels?: string;
    /** 是否输出请求体到 debug 日志（截断） */
    logRequestBody?: boolean;
}

/**
 * 代理日志接口
 * 适配 OpenClaw 的 PluginLogger 接口
 */
export interface ProxyLogger {
    info: (obj: unknown, msg?: string) => void;
    debug: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
}

/**
 * 代理服务句柄
 */
export interface ProxyHandle {
    /** HTTP 服务器实例 */
    server: Server;
    /** 停止代理服务 */
    stop: () => Promise<void>;
}
