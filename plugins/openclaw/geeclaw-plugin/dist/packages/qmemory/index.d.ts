/**
 * qmemory — 任务恢复 Package
 *
 * 任务恢复插件，记录任务执行过程中的 checkpoint，
 * 在 OpenClaw crash 重启后支持恢复中断的任务。
 *
 * 核心能力：
 * - Hook: before_prompt_build (checkpoint + 恢复激活),
 *         before_tool_call / after_tool_call (步骤记录),
 *         agent_end (任务完成标记 + 恢复确认)
 * - Fetch 中间件: 拦截 LLM 请求注入恢复指令
 * - HTTP 路由: /status, /dismiss, /dismiss-all, /cleanup
 * - 命令: /resume
 *
 * 迁移自: extensions/qmemory/
 */
import type { GeeClawPackage } from '../../core/types.js';
export { summarizeResult } from './src/checkpoint-recorder.js';
export { isUserRequestingResume, extractUserInput, buildStepsSummary, summarizeParams, } from './src/recovery-engine.js';
/**
 * qmemory 暴露给 geeclaw-plugin index.ts 的公开 API
 *
 * 用于注册非标 Hook 事件（session_start / session_end），
 * 这些事件不在 HookProxy 的 HookEvent 类型中，
 * 需要由 geeclaw-plugin 主入口通过 api.on() 直接注册。
 */
export interface QMemoryPublicApi {
    /** session_start 回调：创建任务 */
    onSessionStart(sessionKey: string, agentId: string): void;
    /** session_end 回调：从内存移除活跃任务（保留 WAL） */
    onSessionEnd(sessionKey: string): void;
}
declare const qmemory: GeeClawPackage;
export default qmemory;
