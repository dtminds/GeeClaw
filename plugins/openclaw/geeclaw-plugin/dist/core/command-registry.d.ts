/**
 * core/command-registry.ts — 命令注册器
 *
 * 将 package 注册的聊天命令统一代理到 OpenClaw 的 api.registerCommand。
 */
import type { CommandConfig, OpenClawPluginApi } from './types.js';
export interface RegisteredCommand {
    packageId: string;
    command: CommandConfig;
}
export declare class CommandRegistry {
    private api;
    private commands;
    constructor(api: OpenClawPluginApi);
    /**
     * 注册一个聊天命令
     * @param packageId 来源 package 的 ID
     * @param command 命令配置
     */
    register(packageId: string, command: CommandConfig): void;
    /**
     * 获取所有已注册的命令（用于调试/测试）
     */
    getCommands(): readonly RegisteredCommand[];
}
