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
import type { HttpRouteConfig, OpenClawPluginApi } from './types.js';
export interface RegisteredHttpRoute {
    packageId: string;
    route: HttpRouteConfig;
    fullPath: string;
}
export declare class HttpRouteRegistry {
    private api;
    private routes;
    /**
     * 同一个 fullPath 下的 method → handler 映射。
     * OpenClaw 对同 path 只允许注册一个 handler，所以需要合并。
     */
    private handlersByPath;
    /** 已经向 OpenClaw 注册过的 path 集合（防止重复注册） */
    private registeredPaths;
    constructor(api: OpenClawPluginApi);
    /**
     * 注册一个 HTTP 路由
     * @param packageId 来源 package 的 ID
     * @param route 路由配置
     */
    register(packageId: string, route: HttpRouteConfig): void;
    /**
     * 获取所有已注册的 HTTP 路由（用于调试/测试）
     */
    getRoutes(): readonly RegisteredHttpRoute[];
}
