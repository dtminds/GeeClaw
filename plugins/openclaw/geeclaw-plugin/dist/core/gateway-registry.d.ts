/**
 * core/gateway-registry.ts — Gateway 方法注册器
 *
 * 将 package 注册的 Gateway 方法统一代理到 OpenClaw 的 api.registerGatewayMethod。
 * 自动为方法名添加 geeclaw-plugin.<packageId>. 前缀，同时注册不带前缀的短名称别名，
 * 保证外部调用方（UI 端、wechat-access 等）可以继续使用短名称调用。
 */
import type { GatewayMethodHandler, OpenClawPluginApi } from './types.js';
export interface RegisteredGatewayMethod {
    packageId: string;
    method: string;
    fullMethod: string;
    handler: GatewayMethodHandler;
}
export declare class GatewayRegistry {
    private api;
    private methods;
    /** 已注册的短名称 → 来源 packageId，用于检测冲突 */
    private registeredShortMethods;
    constructor(api: OpenClawPluginApi);
    /**
     * 注册一个 Gateway 方法
     *
     * 同时注册两个方法名：
     * 1. 带前缀的完整方法名：geeclaw-plugin.<packageId>.<method>
     * 2. 不带前缀的短名称别名：<method>（向后兼容外部调用方）
     *
     * 如果短名称已被其他 package 注册，仅打印 warn 日志，不覆盖。
     *
     * @param packageId 来源 package 的 ID
     * @param method 方法名（不含前缀）
     * @param handler 处理函数
     */
    register(packageId: string, method: string, handler: GatewayMethodHandler): void;
    /**
     * 获取所有已注册的 Gateway 方法（用于调试/测试）
     */
    getMethods(): readonly RegisteredGatewayMethod[];
}
