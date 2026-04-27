/**
 * core/context.ts — GeeClawContext 工厂函数
 *
 * 为每个 package 创建独立的 GeeClawContext 实例，
 * 将 HookProxy、FetchChain、ConfigCenter 等核心模块的能力
 * 通过统一的 API 暴露给 package。
 */
import { createLogger } from './logger.js';
/**
 * 为指定 package 创建 GeeClawContext 实例
 */
export function createGeeClawContext(options) {
    const { api, packageId, hookProxy, fetchChain, configCenter, gatewayRegistry, httpRouteRegistry, commandRegistry, reporter, getPackageApi, } = options;
    const logger = createLogger(packageId);
    function getToolLogName(tool, toolOptions) {
        if (typeof tool === 'function') {
            return toolOptions?.name ?? tool.name ?? 'anonymous-tool';
        }
        return tool.name;
    }
    const ctx = {
        logger,
        onHook(event, handler, hookOptions) {
            hookProxy.register(event, packageId, handler, hookOptions?.priority, hookOptions?.concurrent);
        },
        onSyncHook(event, handler, hookOptions) {
            hookProxy.registerSync(event, packageId, handler, hookOptions?.priority);
        },
        registerFetchMiddleware(middleware) {
            fetchChain.register(middleware);
        },
        registerGatewayMethod(method, handler) {
            gatewayRegistry.register(packageId, method, handler);
        },
        registerHttpRoute(route) {
            httpRouteRegistry.register(packageId, route);
        },
        registerCommand(command) {
            commandRegistry.register(packageId, command);
        },
        registerTool(tool, toolOptions) {
            if (api.registerTool) {
                api.registerTool(tool, toolOptions);
                logger.info(`registered tool: ${getToolLogName(tool, toolOptions)}`);
            }
            else {
                logger.warn(`api.registerTool not available, skipping: ${getToolLogName(tool, toolOptions)}`);
            }
        },
        registerService(service) {
            // 兼容 OpenClaw 原生 Service 格式（使用 id 字段）和 GeeClawPackage ServiceDefinition（使用 name 字段）
            const serviceName = service.name ?? service.id ?? 'unknown';
            if (api.registerService) {
                api.registerService(service);
                logger.info(`registered service: ${serviceName}`);
            }
            else {
                logger.warn(`api.registerService not available, skipping: ${serviceName}`);
            }
        },
        getConfig() {
            return configCenter.getPackageConfig(packageId);
        },
        onConfigChange(callback) {
            return configCenter.onConfigChange(packageId, (_pkgId, newConfig) => {
                callback(newConfig);
            });
        },
        runtime: {
            stateDir: api.runtime?.stateDir ?? '',
            version: api.runtime?.version ?? '',
            config: api.runtime?.getConfig?.() ?? {},
            getConfig: () => api.runtime?.getConfig?.() ?? {},
        },
        getPackageApi(targetPackageId) {
            return getPackageApi(targetPackageId);
        },
        getOriginalFetch() {
            return fetchChain.getOriginalFetch();
        },
        onHookHandlerExecuted(observer) {
            return hookProxy.onHandlerExecuted(observer);
        },
        onMiddlewareExecuted(observer) {
            return fetchChain.onMiddlewareExecuted(observer);
        },
        reporter: reporter.createPackageReporter(packageId),
    };
    return ctx;
}
