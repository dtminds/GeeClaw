/**
 * 任务恢复引擎
 *
 * 在 OpenClaw crash 重启后：
 * 1. 扫描未完成的 WAL 任务
 * 2. 构造恢复上下文（已完成步骤摘要）
 * 3. 通过 FetchMiddleware 直接修改发给 LLM 的 messages，注入恢复指令
 *
 * 迁移说明：
 * - 原插件通过 globalThis.fetch 覆盖实现拦截
 * - 迁移后通过 ctx.registerFetchMiddleware() 注册标准 FetchMiddleware
 * - 不再需要 queueMicrotask hack 和防重入标记
 *
 * 迁移自: extensions/qmemory/src/recovery-engine.ts
 */
import type { WalStore } from './wal-store.js';
import type { TaskRecord, TaskStep, RecoveryContext } from './types.js';
import type { GeeClawLogger, FetchMiddleware } from '../../../core/types.js';
export declare class RecoveryEngine {
    private readonly walStore;
    private readonly logger;
    /** 待恢复的任务上下文列表 */
    private pendingRecoveries;
    /** 全局恢复模式标记（有未完成任务时激活） */
    private recoveryMode;
    /** 按 sessionKey 存储的 armed 注入上下文 */
    private armedInjections;
    /** 已注入恢复上下文的 sessionKey 集合，避免重复注入 */
    private injectedSessions;
    /** 已注入但尚未确认完成的旧任务 taskId，等 agent_end(success=true) 后再删 WAL */
    private pendingWalCleanup;
    /** 调试信息：记录最近一次注入的详细情况 */
    private lastInjectionDebug;
    constructor(opts: {
        walStore: WalStore;
        logger: GeeClawLogger;
    });
    /**
     * 初始化恢复：扫描中断任务，每个 session 保留最近一个用于恢复。
     */
    initialize(): TaskRecord[];
    /** 获取所有待恢复的任务 */
    getPendingRecoveries(): Map<string, RecoveryContext>;
    /** 获取指定会话的恢复上下文 */
    getRecoveryContext(sessionKey: string): RecoveryContext | undefined;
    /** 放弃恢复单个任务：清理内存上下文 + 删除磁盘 WAL */
    dismissOne(sessionKey: string): void;
    /** 清空所有待恢复任务 */
    clearAll(): void;
    /** 是否处于恢复模式 */
    isRecoveryMode(): boolean;
    /** 获取最近一次注入的调试信息 */
    getLastInjectionDebug(): typeof this.lastInjectionDebug;
    /** 已注入恢复上下文的会话数量 */
    getInjectedSessionsCount(): number;
    /** 是否有暂存的待清理 WAL */
    hasPendingWalCleanup(): boolean;
    /** 确认恢复任务已完成，真正删除旧的 WAL 文件 */
    confirmRecoveryComplete(): void;
    /**
     * before_prompt_build 钩子：标记 fetch 拦截器激活
     *
     * Session 隔离：只有当前 sessionKey 与中断任务的 sessionKey 匹配时才激活恢复
     */
    onBeforePromptBuild(_event: Record<string, unknown>, ctx: {
        sessionKey?: string;
        [key: string]: unknown;
    }): void;
    /**
     * 创建 FetchMiddleware（替代原 setupFetchInterceptor）
     *
     * 通过 ctx.registerFetchMiddleware() 注册，不再直接覆盖 globalThis.fetch
     */
    createFetchMiddleware(): FetchMiddleware;
    /** 查找最早 arm 的 session（Map 迭代按插入顺序，即 FIFO） */
    private findEarliestArmedSession;
    /** 消费一个 armed 注入 */
    private consumeArmedInjection;
    private buildRecoveryContext;
}
/**
 * 判断用户输入是否表达了"继续执行中断任务"的意图
 */
export declare function isUserRequestingResume(userInput: string): boolean;
/**
 * 从原始 prompt 中提取用户真实输入
 */
export declare function extractUserInput(prompt: string): string;
/**
 * 构建已完成步骤摘要
 */
export declare function buildStepsSummary(steps: TaskStep[]): string;
/**
 * 精简参数字符串
 */
export declare function summarizeParams(params: Record<string, unknown>): string;
