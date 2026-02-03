declare module "openclaw/plugin-sdk" {
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
    };
}
