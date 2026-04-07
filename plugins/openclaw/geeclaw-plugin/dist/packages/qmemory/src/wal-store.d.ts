/**
 * WAL (Write-Ahead Log) 持久化存储
 *
 * 每个活跃任务对应一个 JSON 文件: {walDir}/{taskId}.json
 *
 * 写盘分级策略（兼顾性能与 crash 安全）:
 * - createTask / finishTask: 同步写盘（任务生命周期关键节点，必须持久化）
 * - addStep (before_tool_call): 只更新内存，不写盘（pending 步骤 crash 后无恢复价值）
 * - completeStep (after_tool_call): 异步写盘（尽快持久化已完成步骤，但不阻塞主线程）
 * - syncTask: 异步写盘（非关键补充记录）
 *
 * 迁移自: extensions/qmemory/src/wal-store.ts
 */
import type { TaskRecord, TaskStatus, TaskStep } from './types.js';
import type { GeeClawLogger } from '../../../core/types.js';
export declare class WalStore {
    private readonly walDir;
    private readonly maxFiles;
    private readonly retentionMs;
    private readonly logger;
    /** 内存中的活跃任务映射: sessionKey → TaskRecord */
    private activeTasks;
    constructor(opts: {
        walDir: string;
        maxFiles?: number;
        retentionMs?: number;
        logger: GeeClawLogger;
    });
    private ensureDir;
    private walFilePath;
    /** 同步持久化任务记录到磁盘（用于生命周期关键节点） */
    private flushSync;
    /** 异步持久化任务记录到磁盘（用于非关键写盘，不阻塞主线程） */
    private flushAsync;
    /** 将活跃任务的内存状态异步写到磁盘 */
    syncTask(sessionKey: string): void;
    /** 删除磁盘上的任务记录 */
    private removeFromDisk;
    /** 创建新任务（同步写盘：任务必须持久化才能在 crash 后被发现） */
    createTask(sessionKey: string, agentId: string, prompt?: string): TaskRecord;
    /** 获取当前会话的活跃任务 */
    getActiveTask(sessionKey: string): TaskRecord | undefined;
    /** 从内存中移除活跃任务（但不删除磁盘文件，用于程序退出时保留未完成任务的 WAL） */
    removeActiveTask(sessionKey: string): void;
    /**
     * 添加步骤（工具调用开始）— 只更新内存，不写盘
     *
     * pending 状态的步骤在 crash 后没有恢复价值（工具调用尚未完成），
     * 省掉这次写盘可以减少一半的磁盘 I/O。
     */
    addStep(sessionKey: string, step: Omit<TaskStep, 'seq' | 'status' | 'startedAt'>): void;
    /**
     * 更新步骤结果（工具调用完成）— 异步写盘
     */
    completeStep(sessionKey: string, toolCallId: string | undefined, toolName: string, result: unknown, isError: boolean): void;
    /** 完成任务（同步写盘/删除：生命周期终结点，必须确保一致性） */
    finishTask(sessionKey: string, status?: TaskStatus): void;
    /** 将中断任务标记为已恢复，并从磁盘删除 */
    markRecovered(taskId: string): void;
    /**
     * 扫描并标记中断任务，用于 crash 恢复。
     * - 将 status=running 的任务标记为 interrupted 并写回磁盘
     * - 同时收集已经是 interrupted 状态的任务（幂等：多次调用返回相同结果）
     */
    collectInterruptedTasks(): TaskRecord[];
    /** 清理过期的和超出限制的 WAL 文件 */
    cleanup(): void;
    private findPendingStep;
}
