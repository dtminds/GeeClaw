/**
 * core/hook-proxy.ts — Hook 代理
 *
 * 设计原则：
 * 1. geeclaw 对每个事件只注册一次 api.on()
 * 2. 内部维护 handler 列表，按 priority 升序排列（数字越小越先执行）
 * 3. 支持 block 语义：handler 返回 { block: true } 时，后续 handler 不再执行
 * 4. 支持 params 改写：handler 返回 { params: newParams } 时，后续 handler 收到改写后的 params
 * 5. 支持 appendSystemContext 合并
 * 6. 单个 handler 异常不影响其他 handler
 * 7. 支持 concurrent 并行执行：标记为 concurrent 的相邻 handler 会并发执行，减少等待时间
 */
import type { HookEvent, HookHandler, RegisteredHandler, SyncHookEvent, SyncHookHandler, RegisteredSyncHandler, OpenClawPluginApi, HookHandlerExecutedEvent } from './types.js';
/**
 * 执行组：连续的 concurrent handler 组成一个并行组，非 concurrent handler 单独成组
 */
interface ExecutionGroup {
    /** 是否并行执行 */
    parallel: boolean;
    /** 组内的 handler 列表（已按 priority 排序） */
    entries: RegisteredHandler[];
}
export declare class HookProxy {
    /** 按事件分组的异步 handler 列表 */
    private handlers;
    /** 按事件分组的同步 handler 列表 */
    private syncHandlers;
    /** 已向 OpenClaw 注册过的事件集合（每个事件只注册一次 api.on） */
    private registered;
    /** OpenClaw 插件 API */
    private api;
    /** handler 执行后的通用 observer 列表 */
    private handlerExecutedObservers;
    constructor(api: OpenClawPluginApi);
    /**
     * 注册一个异步 Hook handler
     * @param event Hook 事件名
     * @param packageId 来源 package 的 ID
     * @param handler 处理函数
     * @param priority 优先级（数字越小越先执行，默认 500）
     * @param concurrent 是否可与相邻 concurrent handler 并行执行（默认 false）
     */
    register(event: HookEvent, packageId: string, handler: HookHandler, priority?: number, concurrent?: boolean): void;
    /**
     * 注册一个同步 Hook handler
     *
     * 同步 hook 用于需要可靠替换事件数据的场景（如 tool_result_persist）。
     * handler 必须是同步函数，禁止返回 Promise。
     * 按 priority 升序串行执行，后一个 handler 的返回值覆盖前一个。
     *
     * @param event 同步 Hook 事件名
     * @param packageId 来源 package 的 ID
     * @param handler 同步处理函数
     * @param priority 优先级（数字越小越先执行，默认 500）
     */
    registerSync(event: SyncHookEvent, packageId: string, handler: SyncHookHandler, priority?: number): void;
    /**
     * 同步分发 Hook 事件给所有已注册的同步 handler
     *
     * 链式替换语义：
     * - 按 priority 升序串行执行
     * - handler 返回对象时，合并到累积结果中（后者覆盖前者）
     * - 单个 handler 异常不影响其他 handler
     */
    private dispatchSync;
    /**
     * 将 handler 列表按 concurrent 属性分组为执行组
     * 连续的 concurrent=true handler 合并为一个并行组
     * concurrent=false 的 handler 各自独立成组（串行执行）
     */
    private buildExecutionGroups;
    /**
     * 分发 Hook 事件给所有已注册的 handler
     * 按执行组顺序执行：串行组逐个 await，并行组 Promise.allSettled 并发
     */
    private dispatch;
    /**
     * 注册 handler 执行后的通用 observer
     * 每次任意 hook handler 执行完毕后触发，携带事件名、packageId、priority 和返回值
     * @returns 取消注册的函数
     */
    onHandlerExecuted(observer: (ev: HookHandlerExecutedEvent) => void): () => void;
    /**
     * 获取某个异步事件的所有已注册 handler（用于调试/测试）
     */
    getHandlers(event: HookEvent): readonly RegisteredHandler[];
    /**
     * 获取某个同步事件的所有已注册 handler（用于调试/测试）
     */
    getSyncHandlers(event: SyncHookEvent): readonly RegisteredSyncHandler[];
    /**
     * 获取所有已注册的事件列表（包含异步和同步，用于调试/测试）
     */
    getRegisteredEvents(): string[];
    /**
     * 获取某个事件的执行组（用于调试/测试）
     */
    getExecutionGroups(event: HookEvent): ExecutionGroup[];
}
export {};
