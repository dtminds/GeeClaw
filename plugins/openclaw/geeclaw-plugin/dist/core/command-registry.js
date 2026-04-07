/**
 * core/command-registry.ts — 命令注册器
 *
 * 将 package 注册的聊天命令统一代理到 OpenClaw 的 api.registerCommand。
 */
const LOG_TAG = '[geeclaw-plugin:command-registry]';
export class CommandRegistry {
    api;
    commands = [];
    constructor(api) {
        this.api = api;
    }
    /**
     * 注册一个聊天命令
     * @param packageId 来源 package 的 ID
     * @param command 命令配置
     */
    register(packageId, command) {
        this.commands.push({ packageId, command });
        if (this.api.registerCommand) {
            this.api.registerCommand(command);
            console.log(`${LOG_TAG} registered command: /${command.name} (from ${packageId})`);
        }
        else {
            console.warn(`${LOG_TAG} api.registerCommand not available, skipping: /${command.name}`);
        }
    }
    /**
     * 获取所有已注册的命令（用于调试/测试）
     */
    getCommands() {
        return this.commands;
    }
}
