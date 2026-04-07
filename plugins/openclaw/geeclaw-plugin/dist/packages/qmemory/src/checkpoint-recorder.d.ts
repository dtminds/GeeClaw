/**
 * Checkpoint 记录器
 *
 * 监听 OpenClaw 的钩子事件，将任务执行过程中的每一步工具调用
 * 记录到 WAL 中，作为 crash 恢复的依据。
 *
 * 迁移说明：
 * - 原插件通过 api.on() 注册 session_start/session_end 等事件
 * - 迁移后通过 GeeClawContext.onHook() 注册标准 HookEvent
 * - session_start/session_end 不在标准 HookEvent 中，
 *   改为完全依赖 before_prompt_build / before_tool_call 的兜底创建
 *   和 agent_end 的清理逻辑（原插件已有这些兜底路径）
 *
 * 迁移自: extensions/qmemory/src/checkpoint-recorder.ts
 */
import type { WalStore } from './wal-store.js';
import type { GeeClawLogger } from '../../../core/types.js';
/** Hook 上下文 */
interface HookCtx {
    sessionKey?: string;
    agentId?: string;
    [key: string]: unknown;
}
export declare class CheckpointRecorder {
    private readonly walStore;
    private readonly logger;
    constructor(walStore: WalStore, logger: GeeClawLogger);
    /**
     * session_start 钩子 — 创建任务（非标事件，由 geeclaw-plugin index.ts 通过 api.on 注册）
     *
     * 与原插件逻辑一致：如果该会话已有活跃任务，先结束旧任务，再创建新任务。
     * 此方法会立即写盘（WAL），确保 crash 后任务可被发现。
     */
    onSessionStart(sessionKey: string, agentId: string): void;
    /**
     * session_end 钩子 — 从内存移除活跃任务，保留 WAL（非标事件，由 geeclaw-plugin index.ts 通过 api.on 注册）
     *
     * 与原插件逻辑一致：session_end 在程序正常退出时也会触发，此时任务可能没有真正完成。
     * 真正的任务完成标记由 agent_end (success=true) 负责。
     */
    onSessionEnd(sessionKey: string): void;
    /**
     * before_prompt_build 钩子 — 捕获用户 prompt
     *
     * 与原插件逻辑一致：仅用于兜底创建任务（session_start 未触发时）和补充 originalPrompt。
     */
    onBeforePromptBuild(event: Record<string, unknown>, ctx: HookCtx): void;
    /**
     * before_tool_call 钩子 — 记录步骤开始，兜底创建任务
     */
    onBeforeToolCall(event: Record<string, unknown>, ctx: HookCtx): void;
    /**
     * after_tool_call 钩子 — 记录步骤完成
     */
    onAfterToolCall(event: Record<string, unknown>, ctx: HookCtx): void;
    /**
     * agent_end 钩子 — 标记任务完成或保留 WAL
     */
    onAgentEnd(event: Record<string, unknown>, ctx: HookCtx): void;
}
/**
 * 精简工具调用结果，避免 WAL 文件过大
 * 只保留关键信息，截断过长内容
 */
export declare function summarizeResult(result: unknown): unknown;
export {};
