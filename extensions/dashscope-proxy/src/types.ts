export type ThinkLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type DashScopeProxyConfig = {
    bind: string;
    port: number;
    targetBaseUrl: string;
    thinkingEnabled: boolean;
    thinkingBudget: number;
    thinkingModels?: string;
    logRequestBody: boolean;
};

export type ProxyLogger = {
    debug?: (payload: Record<string, unknown>, message?: string) => void;
    info?: (payload: Record<string, unknown>, message?: string) => void;
    warn?: (payload: Record<string, unknown>, message?: string) => void;
    error?: (payload: Record<string, unknown>, message?: string) => void;
};

export type ProxyHandle = {
    stop: () => Promise<void>;
};
