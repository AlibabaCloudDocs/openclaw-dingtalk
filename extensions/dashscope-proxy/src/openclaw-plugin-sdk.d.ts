declare module "openclaw/plugin-sdk" {
    export type ModelDefinitionConfig = {
        id: string;
        name: string;
        reasoning: boolean;
        input: Array<"text" | "image">;
        cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
        };
        contextWindow: number;
        maxTokens: number;
        compat?: {
            supportsDeveloperRole?: boolean;
            supportsReasoningEffort?: boolean;
        };
    };

    export type ModelProviderConfig = {
        baseUrl: string;
        apiKey?: string;
        api?: string;
        authHeader?: boolean;
        models: ModelDefinitionConfig[];
    };

    export type ProviderAuthMethod = {
        id: string;
        label: string;
        hint?: string;
        kind: string;
        run: (ctx: any) => Promise<any>;
    };

    export type ProviderPlugin = {
        id: string;
        label: string;
        docsPath?: string;
        aliases?: string[];
        models?: ModelProviderConfig;
        auth: ProviderAuthMethod[];
    };

    export type PluginLogger = {
        debug?: (message: string) => void;
        info: (message: string) => void;
        warn: (message: string) => void;
        error: (message: string) => void;
    };

    export type OpenClawPluginServiceContext = {
        config: unknown;
        workspaceDir?: string;
        stateDir: string;
        logger: PluginLogger;
    };

    export type OpenClawPluginService = {
        id: string;
        start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
        stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
    };

    export type OpenClawPluginApi = {
        id: string;
        pluginConfig?: Record<string, unknown>;
        registerService: (service: OpenClawPluginService) => void;
        registerProvider: (provider: ProviderPlugin) => void;
    };
}
