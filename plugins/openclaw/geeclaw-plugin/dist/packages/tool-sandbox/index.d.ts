/**
 * tool-sandbox — 工具执行沙箱 Package
 *
 * 核心机制：通过 before_tool_call 钩子改写 params.command，
 * 将原始命令包装为 lowpriv wrapper 调用，在低权限沙箱中执行。
 *
 * ★ 黑名单机制：
 *   内置一份受保护目录黑名单（OS 核心、凭据密钥、浏览器数据等）。
 *   如果命令操作的路径命中黑名单 → 以低权限执行（lowpriv wrapper）。
 *   如果命令操作的路径不在黑名单中 → 正常权限执行。
 *   无法从命令中提取路径 → 保守策略，以低权限执行。
 *
 * ★ 平台支持：
 * - Windows: 完整降权支持（lowpriv-launcher.exe，Low Integrity Level）
 * - macOS / Linux: 暂不支持降权（lowpriv wrapper 未实现），但仍保留
 *   blockPatterns 和内置命令阻断能力，exec 命令不做降权包装
 *
 * 设计原则：
 * - 对 exec 类工具（bash_tool / execute_command）进行命令改写，降权执行（仅限 Windows）
 * - 对文件写操作工具（write_to_file / replace_in_file 等）检查目标路径，
 *   命中受保护目录时直接阻止（block），防止绕过 exec 降权的安全漏洞
 * - blockPatterns 高危命令拦截在所有平台上生效
 * - 对 read_file / search 等只读工具放行
 * - 降权失败时（wrapper 不存在）回退到正常执行 + stderr 告警
 * - 技能管理命令（npx skills / clawhub）跳过降权，以正常权限运行
 *   这类命令需要写入 ~/.geeclaw/skills/ 等受保护目录，降权后必然失败
 *
 * 动态开关机制（★ 无需重启进程即可生效）：
 * - 降权开关通过 ConfigCenter 统一管理（ctx.getConfig() + ctx.onConfigChange()）
 * - Electron 端通过 GeeClawPluginConfigWriter 将 toolSandbox.enabled 写入 geeclaw-plugin-config.json
 * - ConfigCenter 的 fs.watch 感知文件变更后自动通知 tool-sandbox
 * - 环境变量 GEECLAW_TOOL_LOWPRIV 仍作为初始值兜底（ConfigCenter 无配置时回退）
 *
 * 环境变量（由 Electron createCleanEnv() 注入，仅 Windows）：
 * - GEECLAW_TOOL_LOWPRIV=1               降权总开关（初始值，ConfigCenter 配置优先级更高）
 * - GEECLAW_TOOL_WRAPPER_PATH=path       wrapper 可执行文件路径
 * - GEECLAW_TOOL_SANDBOX_LEVEL=level     降权级别（standard/strict/custom）
 *
 * 迁移自: extensions/tool-sandbox/index.ts
 */
import type { GeeClawPackage } from '../../core/types.js';
export interface ToolSandboxConfig {
    /** 降权总开关（由 Electron 端通过 ConfigCenter 动态下发） */
    enabled: boolean;
    auditLog: boolean;
    blockPatterns: string[];
    denyWritePaths: string[];
}
interface PermissionDeniedInfo {
    detected: boolean;
    paths: string[];
    directories: string[];
}
export declare function isExecTool(name: string): boolean;
export declare function isFileWriteTool(name: string): boolean;
export declare function isFileReadTool(name: string): boolean;
export declare function expandEnvVarsInCommand(command: string): string;
export declare function extractPathsFromCommand(command: string): string[];
export declare function expandProtectedDirs(patterns: string[]): string[];
export declare function checkRegistryCommand(command: string): {
    blocked: boolean;
    regPath?: string;
    desc?: string;
};
export declare function isCommandInProtectedDirs(command: string, protectedDirs: string[]): boolean;
export declare function isPathInProtectedDirs(filePath: string, protectedDirs: string[]): boolean;
export declare function isPathInCredentialDirs(filePath: string, credentialDirs: string[]): boolean;
export declare function extractLaunchTarget(command: string): string | null;
export declare function isLaunchTargetInUntrustedDir(command: string): boolean;
export declare function isAppLaunchCommand(command: string): boolean;
/**
 * 判断命令是否为技能管理命令（npx skills / clawhub / npm install -g clawhub）
 *
 * - blockPatterns 高危命令拦截仍在上方生效，不会被本函数绕过
 * - 仅匹配特定的技能管理工具命令，不是通配放行
 * - 技能安装的目标目录受 SkillPlugin 的 sanitizeSkillSlug() + assertPathWithin() 保护
 * - ★ 安全修复：所有正则使用 $ 行尾锚定 + 安全字符集，防止通过追加 shell 元字符绕过降权
 */
export declare function isSkillManagementCommand(command: string): boolean;
export declare function getWindowsLauncherArgs(level: string): string;
export declare function resolvePowerShellPath(): string;
export declare function wrapCommandWindows(command: string, wrapperPath: string, level: string, psPath: string): string;
export declare function wrapCommandForPlatform(command: string, wrapperPath: string, level: string, psPath: string): string | null;
export declare function buildBlockMessage(reason: string, affectedTarget?: string): string;
export declare function detectLowprivError(output: string): boolean;
export declare function detectPermissionDenied(output: string): PermissionDeniedInfo;
export declare function checkLockedDirsForCommand(command: string, lockedDirs: Set<string>): string | null;
export declare function checkContentForLockedDirs(content: string, lockedDirs: Set<string>): string | null;
export declare function checkContentForProtectedDirs(content: string, credentialDirs: string[]): string | null;
export declare function checkExecScriptContent(command: string, credentialDirs: string[]): string | null;
export declare function findTriggerDir(command: string, protectedDirs: string[]): string;
declare const toolSandbox: GeeClawPackage;
/**
 * 生成用于 tool_result_persist 的终止性错误纯文本
 *
 * ★ 必须使用纯文本而非 JSON：
 *   AI 模型读取 toolResult 的 content[].text 字段，如果内容是 JSON 字符串，
 *   换行符会被 JSON 转义为 \n，模型看到的是单行文本，指令效果大打折扣。
 *   纯文本格式确保模型看到格式化好的多行指令。
 *
 * @param toolName 工具名
 * @param reason 拦截原因
 * @param affectedTarget 受影响的目录或路径
 */
export declare function buildTerminalErrorPayload(toolName: string, reason: string, affectedTarget?: string): string;
export default toolSandbox;
