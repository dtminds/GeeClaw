/**
 * core/config-center.ts — 配置中心
 *
 * 统一管理 geeclaw 的配置，按 package ID 分发配置段。
 * 每个 package 只能访问自己的配置段。
 *
 * ★ 两层优先级（高 → 低）：
 *   1. fileConfig[packageId]    — 动态配置（从 geeclaw-plugin-config.json 读取）
 *   2. staticConfig[packageId]  — 静态配置（openclaw.json 中的 pluginConfig）
 *   3. {} 空对象               — 默认值
 *
 * ★ 设计原则：
 *   - OpenClaw 端只读不写，Electron 端负责写入配置文件
 *   - 使用 fs.watch + 防抖 + TTL 兜底感知文件变更
 *   - JSON.parse 失败时保持上次有效配置 + 告警日志
 *   - 各 package 通过 ctx.getConfig() 获取合并后的配置
 *   - 通过 ctx.onConfigChange() 监听配置变更
 *
 * 配置文件结构约定（geeclaw-plugin-config.json）：
 * {
 *   "tool-sandbox": { "enabled": true },
 *   "pcmgr-ai-security": { "enablePromptAudit": false },
 *   ...
 * }
 */
/** 配置变更回调 */
export type ConfigChangeCallback = (packageId: string, newConfig: Record<string, unknown>) => void;
/** ConfigCenter 构造参数 */
export interface ConfigCenterOptions {
    /** 静态配置（来自 openclaw.json 的 pluginConfig） */
    staticConfig: Record<string, unknown>;
    /** 配置文件路径（geeclaw-plugin-config.json），为空则不启用文件配置层 */
    configFilePath?: string;
    /** fs.watch 防抖延迟（毫秒），默认 300 */
    debounceMs?: number;
    /** TTL 兜底时间（毫秒），默认 10000 */
    ttlMs?: number;
}
export declare class ConfigCenter {
    /** 静态配置（来自 openclaw.json） */
    private readonly staticConfig;
    /** 文件配置（从 geeclaw-plugin-config.json 读取） */
    private fileConfig;
    /** 配置文件路径 */
    private readonly configFilePath;
    /** 配置变更监听器（按 packageId 分组） */
    private readonly listeners;
    /** fs.watch 实例 */
    private watcher;
    /** 防抖定时器 */
    private debounceTimer;
    /** 防抖延迟（毫秒） */
    private readonly debounceMs;
    /** TTL 兜底时间（毫秒） */
    private readonly ttlMs;
    /** 上次成功读取文件的时间戳 */
    private lastReadTimestamp;
    /** 是否已销毁 */
    private destroyed;
    constructor(options: ConfigCenterOptions);
    /**
     * 获取指定 package 的配置段（两层合并）
     *
     * 合并优先级：fileConfig > staticConfig > {}
     * 使用浅合并（Object.assign 语义），fileConfig 中的字段覆盖 staticConfig 中的同名字段。
     *
     * 如果 TTL 过期，会先强制重读配置文件再返回。
     *
     * @param packageId package 的唯一标识
     * @returns 合并后的配置对象
     */
    getPackageConfig<T = Record<string, unknown>>(packageId: string): T;
    /**
     * 获取完整的合并后配置（用于调试）
     *
     * 返回所有 package 的合并配置，包括只在 fileConfig 中存在的 package。
     */
    getFullConfig(): Record<string, unknown>;
    /**
     * 监听指定 package 的配置变更
     *
     * 当配置文件变更导致该 package 的配置发生变化时，回调会收到合并后的完整配置。
     * 返回取消监听的函数。
     *
     * @param packageId package 的唯一标识
     * @param callback 变更回调
     * @returns 取消监听的函数
     */
    onConfigChange(packageId: string, callback: ConfigChangeCallback): () => void;
    /**
     * 获取当前文件配置层的原始内容（用于调试）
     */
    getFileConfig(): Record<string, unknown>;
    /**
     * 销毁 ConfigCenter，清理 fs.watch 和定时器资源
     */
    destroy(): void;
    /** 从配置文件读取内容，解析失败时保持上次有效配置 */
    private readConfigFile;
    /** 启动 fs.watch 监听配置文件变更 */
    private startWatching;
    /** 重新建立 fs.watch（用于文件被删除后重新创建的场景） */
    private restartWatching;
    /** 防抖重新加载配置文件 */
    private debouncedReload;
    /** 重新加载配置文件并通知变更的 package */
    private reloadAndNotify;
    /** TTL 兜底检查：如果缓存过期，强制重读 */
    private checkTtlAndReload;
    /** 通知指定 package 的所有监听器 */
    private notifyListeners;
}
