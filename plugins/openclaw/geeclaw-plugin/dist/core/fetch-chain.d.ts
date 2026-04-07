/**
 * core/fetch-chain.ts — Fetch 中间件链
 *
 * 单点安装 globalThis.fetch，多 package 注册中间件。
 * 执行顺序（洋葱模型）：
 *   request:  priority 100 → 150 → 200 → 250 → originalFetch
 *   response: priority 250 → 200 → 150 → 100
 */
import type { FetchMiddleware, MiddlewareExecutedEvent } from './types.js';
export declare class FetchChain {
    /** 已注册的中间件列表（按 priority 升序） */
    private middlewares;
    /** 原始 fetch 引用 */
    private originalFetch;
    /** 是否已安装 */
    private installed;
    /** middleware 执行后的通用 observer 列表 */
    private middlewareExecutedObservers;
    /**
     * 注册一个 Fetch 中间件
     * 支持在 install() 之前或之后调用（延迟注册）
     */
    register(middleware: FetchMiddleware): void;
    /**
     * 安装 FetchChain，替换 globalThis.fetch
     * 只能调用一次
     */
    install(): void;
    /**
     * 获取原始 fetch（绕过拦截链）
     */
    getOriginalFetch(): typeof fetch;
    /**
     * 注册 middleware 执行后的通用 observer
     * 每次任意 middleware 的 onResponse 执行完毕后触发，携带 middlewareId、priority、modified 等信息
     * @returns 取消注册的函数
     */
    onMiddlewareExecuted(observer: (ev: MiddlewareExecutedEvent) => void): () => void;
    /**
     * 获取已注册的中间件列表（用于调试/测试）
     */
    getMiddlewares(): readonly FetchMiddleware[];
    /**
     * 执行 Fetch 中间件链（洋葱模型）
     */
    private execute;
    /**
     * 卸载 FetchChain，恢复原始 fetch（用于测试清理）
     */
    uninstall(): void;
}
