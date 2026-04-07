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
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export class WalStore {
    walDir;
    maxFiles;
    retentionMs;
    logger;
    /** 内存中的活跃任务映射: sessionKey → TaskRecord */
    activeTasks = new Map();
    constructor(opts) {
        this.walDir = opts.walDir;
        this.maxFiles = opts.maxFiles ?? 20;
        this.retentionMs = opts.retentionMs ?? 24 * 60 * 60 * 1000; // 24h
        this.logger = opts.logger;
        this.ensureDir();
    }
    // ─── 目录管理 ───
    ensureDir() {
        try {
            if (!fs.existsSync(this.walDir)) {
                fs.mkdirSync(this.walDir, { recursive: true });
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`创建 WAL 目录失败: ${msg}`);
            throw new Error(`WAL 目录创建失败 (${this.walDir}): ${msg}`);
        }
    }
    walFilePath(taskId) {
        return path.join(this.walDir, `${taskId}.json`);
    }
    // ─── 读写操作 ───
    /** 同步持久化任务记录到磁盘（用于生命周期关键节点） */
    flushSync(task) {
        try {
            const filePath = this.walFilePath(task.taskId);
            fs.writeFileSync(filePath, JSON.stringify(task), 'utf-8');
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`写入 WAL 失败 (taskId=${task.taskId}): ${msg}`);
            throw e;
        }
    }
    /** 异步持久化任务记录到磁盘（用于非关键写盘，不阻塞主线程） */
    flushAsync(task) {
        try {
            const filePath = this.walFilePath(task.taskId);
            const data = JSON.stringify(task);
            fs.writeFile(filePath, data, 'utf-8', (err) => {
                if (err) {
                    this.logger.error(`异步写入 WAL 失败 (taskId=${task.taskId}): ${err.message}`);
                }
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`异步写入 WAL 序列化失败 (taskId=${task.taskId}): ${msg}`);
        }
    }
    /** 将活跃任务的内存状态异步写到磁盘 */
    syncTask(sessionKey) {
        const task = this.activeTasks.get(sessionKey);
        if (task)
            this.flushAsync(task);
    }
    /** 删除磁盘上的任务记录 */
    removeFromDisk(taskId) {
        try {
            const filePath = this.walFilePath(taskId);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        catch {
            // 删除失败，静默忽略
        }
    }
    // ─── 任务生命周期 ───
    /** 创建新任务（同步写盘：任务必须持久化才能在 crash 后被发现） */
    createTask(sessionKey, agentId, prompt) {
        const now = Date.now();
        const task = {
            taskId: crypto.randomUUID(),
            agentId,
            sessionKey,
            originalPrompt: prompt,
            status: 'running',
            steps: [],
            startedAt: now,
            updatedAt: now,
        };
        this.activeTasks.set(sessionKey, task);
        this.flushSync(task);
        return task;
    }
    /** 获取当前会话的活跃任务 */
    getActiveTask(sessionKey) {
        return this.activeTasks.get(sessionKey);
    }
    /** 从内存中移除活跃任务（但不删除磁盘文件，用于程序退出时保留未完成任务的 WAL） */
    removeActiveTask(sessionKey) {
        this.activeTasks.delete(sessionKey);
    }
    /**
     * 添加步骤（工具调用开始）— 只更新内存，不写盘
     *
     * pending 状态的步骤在 crash 后没有恢复价值（工具调用尚未完成），
     * 省掉这次写盘可以减少一半的磁盘 I/O。
     */
    addStep(sessionKey, step) {
        const task = this.activeTasks.get(sessionKey);
        if (!task)
            return;
        const newStep = {
            ...step,
            seq: task.steps.length + 1,
            status: 'pending',
            startedAt: Date.now(),
        };
        task.steps.push(newStep);
        task.updatedAt = Date.now();
        // 不写盘：pending 步骤 crash 后无价值
    }
    /**
     * 更新步骤结果（工具调用完成）— 异步写盘
     */
    completeStep(sessionKey, toolCallId, toolName, result, isError) {
        const task = this.activeTasks.get(sessionKey);
        if (!task)
            return;
        // 找到最后一个匹配的 pending 步骤
        const step = this.findPendingStep(task, toolCallId, toolName);
        if (!step)
            return;
        step.result = result;
        step.isError = isError;
        step.status = isError ? 'failed' : 'completed';
        step.completedAt = Date.now();
        task.updatedAt = Date.now();
        this.flushAsync(task);
    }
    /** 完成任务（同步写盘/删除：生命周期终结点，必须确保一致性） */
    finishTask(sessionKey, status = 'completed') {
        const task = this.activeTasks.get(sessionKey);
        if (!task)
            return;
        task.status = status;
        task.endedAt = Date.now();
        task.updatedAt = Date.now();
        this.activeTasks.delete(sessionKey);
        if (status === 'completed') {
            // 已完成的任务不需要保存，直接删除 WAL 文件
            this.removeFromDisk(task.taskId);
        }
        else {
            // 非完成状态（如 failed）仍然保留以供分析
            this.flushSync(task);
        }
    }
    // ─── 恢复相关 ───
    /** 将中断任务标记为已恢复，并从磁盘删除 */
    markRecovered(taskId) {
        this.removeFromDisk(taskId);
    }
    /**
     * 扫描并标记中断任务，用于 crash 恢复。
     * - 将 status=running 的任务标记为 interrupted 并写回磁盘
     * - 同时收集已经是 interrupted 状态的任务（幂等：多次调用返回相同结果）
     */
    collectInterruptedTasks() {
        const interrupted = [];
        try {
            const files = fs.readdirSync(this.walDir).filter((f) => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const filePath = path.join(this.walDir, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const task = JSON.parse(content);
                    if (task.status === 'running') {
                        task.status = 'interrupted';
                        task.endedAt = Date.now();
                        task.updatedAt = Date.now();
                        fs.writeFileSync(filePath, JSON.stringify(task), 'utf-8');
                    }
                    if (task.status === 'interrupted') {
                        interrupted.push(task);
                    }
                }
                catch {
                    // 跳过损坏的文件
                }
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`扫描中断任务失败: ${msg}`);
        }
        return interrupted;
    }
    /** 清理过期的和超出限制的 WAL 文件 */
    cleanup() {
        try {
            const files = fs.readdirSync(this.walDir).filter((f) => f.endsWith('.json'));
            const now = Date.now();
            const fileInfos = [];
            for (const file of files) {
                const filePath = path.join(this.walDir, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const task = JSON.parse(content);
                    fileInfos.push({
                        name: file,
                        path: filePath,
                        updatedAt: task.updatedAt ?? 0,
                        status: task.status,
                    });
                }
                catch {
                    // 损坏的文件直接删除
                    try {
                        fs.unlinkSync(filePath);
                    }
                    catch {
                        /* ignore */
                    }
                }
            }
            // 按更新时间排序（最新在前）
            fileInfos.sort((a, b) => b.updatedAt - a.updatedAt);
            for (let i = 0; i < fileInfos.length; i++) {
                const info = fileInfos[i];
                const isExpired = now - info.updatedAt > this.retentionMs;
                const isOverLimit = i >= this.maxFiles;
                const isDone = info.status === 'completed';
                // interrupted 状态的任务保留更久
                if (info.status === 'interrupted') {
                    const interruptedRetention = this.retentionMs * 3;
                    if (now - info.updatedAt <= interruptedRetention)
                        continue;
                }
                if (isExpired || isOverLimit || isDone) {
                    try {
                        fs.unlinkSync(info.path);
                    }
                    catch {
                        /* ignore */
                    }
                }
            }
        }
        catch {
            // WAL 清理失败，静默忽略
        }
    }
    // ─── 内部辅助 ───
    findPendingStep(task, toolCallId, toolName) {
        // 优先按 toolCallId 匹配
        if (toolCallId) {
            const byId = task.steps.find((s) => s.toolCallId === toolCallId && s.status === 'pending');
            if (byId)
                return byId;
        }
        // 回退：按 toolName 匹配最后一个 pending 步骤
        for (let i = task.steps.length - 1; i >= 0; i--) {
            if (task.steps[i].toolName === toolName && task.steps[i].status === 'pending') {
                return task.steps[i];
            }
        }
        return undefined;
    }
}
