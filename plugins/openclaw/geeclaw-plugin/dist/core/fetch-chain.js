/**
 * core/fetch-chain.ts — Fetch 中间件链
 *
 * 单点安装 globalThis.fetch，多 package 注册中间件。
 * 执行顺序（洋葱模型）：
 *   request:  priority 100 → 150 → 200 → 250 → originalFetch
 *   response: priority 250 → 200 → 150 → 100
 */
const LOG_TAG = '[geeclaw-plugin:fetch-chain]';
export class FetchChain {
    /** 已注册的中间件列表（按 priority 升序） */
    middlewares = [];
    /** 原始 fetch 引用 */
    originalFetch = null;
    /** 是否已安装 */
    installed = false;
    /** middleware 执行后的通用 observer 列表 */
    middlewareExecutedObservers = [];
    /**
     * 注册一个 Fetch 中间件
     * 支持在 install() 之前或之后调用（延迟注册）
     */
    register(middleware) {
        // 按 id 去重：相同 id 的中间件只保留最新注册的实例
        const existingIdx = this.middlewares.findIndex((m) => m.id === middleware.id);
        if (existingIdx !== -1) {
            this.middlewares[existingIdx] = middleware;
            console.log(`${LOG_TAG} replaced existing middleware: ${middleware.id}(${middleware.priority}), total: ${this.middlewares.length}`);
        }
        else {
            this.middlewares.push(middleware);
        }
        // 按 priority 升序排列
        this.middlewares.sort((a, b) => a.priority - b.priority);
        if (this.installed) {
            // 延迟注册：install() 已执行，新中间件自动生效（execute() 动态读取 middlewares）
            console.log(`${LOG_TAG} late-registered middleware: ${middleware.id}(${middleware.priority}), total: ${this.middlewares.length}`);
        }
    }
    /**
     * 安装 FetchChain，替换 globalThis.fetch
     * 只能调用一次
     */
    install() {
        if (this.installed) {
            console.warn(`${LOG_TAG} already installed, skipping`);
            return;
        }
        // 保存原始 fetch
        this.originalFetch = globalThis.fetch;
        // 替换 globalThis.fetch
        // 使用 Object.assign 保留原始 fetch 上的静态属性（如 Node.js 22+ 的 preconnect）
        const interceptor = async (input, init) => {
            return this.execute(input, init);
        };
        globalThis.fetch = Object.assign(interceptor, this.originalFetch);
        this.installed = true;
        console.log(`${LOG_TAG} installed with ${this.middlewares.length} middleware(s)${this.middlewares.length > 0 ? `: [${this.middlewares.map((m) => `${m.id}(${m.priority})`).join(', ')}]` : ' (accepting late registrations)'}`);
    }
    /**
     * 获取原始 fetch（绕过拦截链）
     */
    getOriginalFetch() {
        if (!this.originalFetch) {
            // 还没安装，返回当前的 globalThis.fetch
            return globalThis.fetch;
        }
        return this.originalFetch;
    }
    /**
     * 注册 middleware 执行后的通用 observer
     * 每次任意 middleware 的 onResponse 执行完毕后触发，携带 middlewareId、priority、modified 等信息
     * @returns 取消注册的函数
     */
    onMiddlewareExecuted(observer) {
        this.middlewareExecutedObservers.push(observer);
        return () => {
            const idx = this.middlewareExecutedObservers.indexOf(observer);
            if (idx !== -1)
                this.middlewareExecutedObservers.splice(idx, 1);
        };
    }
    /**
     * 获取已注册的中间件列表（用于调试/测试）
     */
    getMiddlewares() {
        return this.middlewares;
    }
    /**
     * 执行 Fetch 中间件链（洋葱模型）
     */
    async execute(input, init) {
        // 筛选匹配的中间件
        const matched = this.middlewares.filter((m) => !m.match || m.match(input, init));
        if (matched.length === 0) {
            // 没有匹配的中间件，直接调用原始 fetch
            return this.originalFetch(input, init);
        }
        // 构造请求上下文
        let ctx = {
            input,
            init,
            extra: {},
        };
        // ---- 洋葱模型：request 阶段（正序） ----
        for (const mw of matched) {
            if (!mw.onRequest)
                continue;
            try {
                ctx = await mw.onRequest(ctx);
            }
            catch (err) {
                console.error(`${LOG_TAG} [${mw.id}] onRequest error:`, err);
            }
        }
        // ---- 短路检测：onRequest 阶段设置了 shortCircuitResponse 则跳过 originalFetch ----
        let response;
        if (ctx.shortCircuitResponse) {
            response = ctx.shortCircuitResponse;
        }
        else {
            // ---- 调用原始 fetch ----
            try {
                response = await this.originalFetch(ctx.input, ctx.init);
            }
            catch (err) {
                // 尝试让中间件处理错误（逆序）
                for (let i = matched.length - 1; i >= 0; i--) {
                    const mw = matched[i];
                    if (!mw.onError)
                        continue;
                    try {
                        const recovered = await mw.onError({
                            input: ctx.input,
                            init: ctx.init,
                            error: err,
                            extra: ctx.extra,
                        });
                        if (recovered)
                            return recovered;
                    }
                    catch (innerErr) {
                        console.error(`${LOG_TAG} [${mw.id}] onError error:`, innerErr);
                    }
                }
                throw err;
            }
        }
        // ---- 洋葱模型：response 阶段（逆序） ----
        for (let i = matched.length - 1; i >= 0; i--) {
            const mw = matched[i];
            if (!mw.onResponse)
                continue;
            try {
                const responseCtx = {
                    input: ctx.input,
                    init: ctx.init,
                    response,
                    extra: ctx.extra,
                };
                const responseBefore = response;
                response = await mw.onResponse(responseCtx);
                // 通知 observer：middleware 执行完毕
                if (this.middlewareExecutedObservers.length > 0) {
                    const modified = response !== responseBefore;
                    const ev = {
                        middlewareId: mw.id,
                        priority: mw.priority,
                        modified,
                        action: modified ? 'transform' : 'pass',
                    };
                    for (const obs of this.middlewareExecutedObservers) {
                        try {
                            obs(ev);
                        }
                        catch { /* 静默忽略 */ }
                    }
                }
            }
            catch (err) {
                console.error(`${LOG_TAG} [${mw.id}] onResponse error:`, err);
                // 异常时通知 observer（pass + detail）
                if (this.middlewareExecutedObservers.length > 0) {
                    const ev = {
                        middlewareId: mw.id,
                        priority: mw.priority,
                        modified: false,
                        action: 'pass',
                        detail: err instanceof Error ? err.message : String(err),
                    };
                    for (const obs of this.middlewareExecutedObservers) {
                        try {
                            obs(ev);
                        }
                        catch { /* 静默忽略 */ }
                    }
                }
            }
        }
        return response;
    }
    /**
     * 卸载 FetchChain，恢复原始 fetch（用于测试清理）
     */
    uninstall() {
        if (!this.installed || !this.originalFetch)
            return;
        globalThis.fetch = this.originalFetch;
        this.originalFetch = null;
        this.installed = false;
    }
}
