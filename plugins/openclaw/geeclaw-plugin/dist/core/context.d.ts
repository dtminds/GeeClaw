/**
 * core/context.ts — GeeClawContext 工厂函数
 *
 * 为每个 package 创建独立的 GeeClawContext 实例，
 * 将 HookProxy、FetchChain、ConfigCenter 等核心模块的能力
 * 通过统一的 API 暴露给 package。
 */
import type { GeeClawContext, OpenClawPluginApi } from './types.js';
import type { HookProxy } from './hook-proxy.js';
import type { FetchChain } from './fetch-chain.js';
import type { ConfigCenter } from './config-center.js';
import type { GatewayRegistry } from './gateway-registry.js';
import type { HttpRouteRegistry } from './http-route-registry.js';
import type { CommandRegistry } from './command-registry.js';
import type { GeeClawReporter } from './reporter.js';
/** createGeeClawContext 的依赖参数 */
export interface CreateContextOptions {
    api: OpenClawPluginApi;
    packageId: string;
    hookProxy: HookProxy;
    fetchChain: FetchChain;
    configCenter: ConfigCenter;
    gatewayRegistry: GatewayRegistry;
    httpRouteRegistry: HttpRouteRegistry;
    commandRegistry: CommandRegistry;
    /** 共享的伽利略上报器实例 */
    reporter: GeeClawReporter;
    /** 获取其他 package 的公开 API */
    getPackageApi: (packageId: string) => unknown | undefined;
}
/**
 * 为指定 package 创建 GeeClawContext 实例
 */
export declare function createGeeClawContext(options: CreateContextOptions): GeeClawContext;
