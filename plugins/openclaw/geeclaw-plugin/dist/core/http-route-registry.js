/**
 * core/http-route-registry.ts — HTTP 路由注册器
 *
 * 将 package 注册的 HTTP 路由统一代理到 OpenClaw 的 api.registerHttpRoute。
 * 自动为路径添加 /geeclaw-plugin/<packageId>/ 前缀。
 *
 * 适配层说明：
 * - GeeClawPackage 使用高层 HttpRequest/HttpResponse 抽象
 * - OpenClaw 原始 api.registerHttpRoute 使用 Node.js (IncomingMessage, ServerResponse) 接口
 * - 本模块负责在两者之间做桥接适配
 */
const LOG_TAG = '[geeclaw-plugin:http-route-registry]';
/**
 * 从 Node.js IncomingMessage 读取请求体并解析为 JSON
 */
function readJsonBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                resolve(raw ? JSON.parse(raw) : {});
            }
            catch {
                resolve({});
            }
        });
        req.on('error', () => resolve({}));
    });
}
/**
 * 解析 URL 中的 query 参数
 */
function parseQuery(url) {
    if (!url)
        return {};
    const idx = url.indexOf('?');
    if (idx < 0)
        return {};
    const result = {};
    const params = new URLSearchParams(url.slice(idx + 1));
    params.forEach((value, key) => { result[key] = value; });
    return result;
}
/**
 * 创建一个分发 handler，根据请求的 HTTP method 找到对应的 GeeClawPackage handler 并执行。
 * 同一个 fullPath 只向 OpenClaw 注册一次，内部通过 method 分发。
 */
function createDispatchHandler(fullPath, methodMap) {
    return async (req, res) => {
        const method = req.method ?? 'GET';
        const handler = methodMap.get(method);
        if (!handler) {
            // 该 method 未注册，返回 405 Method Not Allowed
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
            return true;
        }
        try {
            // 构造 HttpRequest
            const httpReq = {
                method,
                path: req.url ?? '/',
                query: parseQuery(req.url),
                headers: Object.fromEntries(Object.entries(req.headers)
                    .filter((entry) => typeof entry[1] === 'string')),
                body: (method === 'POST' || method === 'PUT' || method === 'PATCH')
                    ? await readJsonBody(req)
                    : undefined,
            };
            // 调用 GeeClawPackage handler
            const httpRes = await handler(httpReq);
            // 写入响应
            const body = JSON.stringify(httpRes.body);
            const headers = {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(body)),
                ...httpRes.headers,
            };
            res.writeHead(httpRes.status, headers);
            res.end(body);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`${LOG_TAG} handler error on ${method} ${fullPath}:`, err);
            const errorBody = JSON.stringify({ error: message });
            res.writeHead(500, {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(errorBody)),
            });
            res.end(errorBody);
        }
        return true;
    };
}
export class HttpRouteRegistry {
    api;
    routes = [];
    /**
     * 同一个 fullPath 下的 method → handler 映射。
     * OpenClaw 对同 path 只允许注册一个 handler，所以需要合并。
     */
    handlersByPath = new Map();
    /** 已经向 OpenClaw 注册过的 path 集合（防止重复注册） */
    registeredPaths = new Set();
    constructor(api) {
        this.api = api;
    }
    /**
     * 注册一个 HTTP 路由
     * @param packageId 来源 package 的 ID
     * @param route 路由配置
     */
    register(packageId, route) {
        const fullPath = `/geeclaw-plugin/${packageId}/${route.path}`.replace(/\/+/g, '/');
        this.routes.push({ packageId, route, fullPath });
        // 将 handler 加入对应 path 的 method 映射
        let methodMap = this.handlersByPath.get(fullPath);
        if (!methodMap) {
            methodMap = new Map();
            this.handlersByPath.set(fullPath, methodMap);
        }
        methodMap.set(route.method, route.handler);
        if (!this.api.registerHttpRoute) {
            console.warn(`${LOG_TAG} api.registerHttpRoute not available, skipping: ${route.method} ${fullPath}`);
            return;
        }
        if (this.registeredPaths.has(fullPath)) {
            // 此 path 已在 OpenClaw 中注册过，新增的 method 会自动被分发 handler 处理
            console.log(`${LOG_TAG} registered HTTP route: ${route.method} ${fullPath} (merged into existing)`);
            return;
        }
        // 首次注册此 path —— 创建一个分发 handler 并注册到 OpenClaw
        this.registeredPaths.add(fullPath);
        const pathMethodMap = methodMap; // 捕获引用，后续新增 method 也会生效
        this.api.registerHttpRoute({
            path: fullPath,
            auth: 'gateway',
            match: 'exact',
            handler: createDispatchHandler(fullPath, pathMethodMap),
        });
        console.log(`${LOG_TAG} registered HTTP route: ${route.method} ${fullPath}`);
    }
    /**
     * 获取所有已注册的 HTTP 路由（用于调试/测试）
     */
    getRoutes() {
        return this.routes;
    }
}
