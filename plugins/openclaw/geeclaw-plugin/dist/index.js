/**
 * geeclaw — 主插件入口
 *
 * GeeClaw 自研功能统一入口。将多个功能模块（package）整合为一个插件，
 * 通过统一的 Hook 代理和 Fetch 中间件链协调执行。
 *
 * 当前仅保留需要的 package：
 * - error-response-handler
 * - cron-delivery-guard
 * - tool-sandbox
 * - qmemory
 */
import { HookProxy } from './core/hook-proxy.js';
import { FetchChain } from './core/fetch-chain.js';
import { ConfigCenter } from './core/config-center.js';
import { GatewayRegistry } from './core/gateway-registry.js';
import { HttpRouteRegistry } from './core/http-route-registry.js';
import { CommandRegistry } from './core/command-registry.js';
import { GeeClawReporter } from './core/reporter.js';
import { createGeeClawContext } from './core/context.js';
// ---- Package 导入 ----
import cronDeliveryGuard from './packages/cron-delivery-guard/index.js';
import toolSandbox from './packages/tool-sandbox/index.js';
import qmemoryPkg from './packages/qmemory/index.js';
import errorResponseHandler from './packages/error-response-handler/index.js';
const LOG_TAG = '[geeclaw-plugin]';
/**
 * 所有功能 package 列表（顺序即初始化顺序）
 *
 * Step 0: 空数组，不迁移任何插件
 * 当前保留：
 *   - error-response-handler（HTTP 错误码 → SSE 友好响应）
 *   - cron-delivery-guard
 *   - tool-sandbox
 *   - qmemory
 */
const PACKAGES = [
    errorResponseHandler,
    cronDeliveryGuard,
    toolSandbox,
    qmemoryPkg,
];
/** 已初始化的 package 实例（用于 getPublicApi 跨 package 通讯） */
const initializedPackages = new Map();
const plugin = {
    id: 'geeclaw-plugin',
    name: 'GeeClaw 主插件',
    description: 'GeeClaw 自研功能统一入口',
    configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
    },
    register(api) {
        console.log(`${LOG_TAG} initializing with ${PACKAGES.length} package(s)...`);
        // 初始化核心模块
        const configCenter = new ConfigCenter({
            staticConfig: (api.pluginConfig ?? {}),
            configFilePath: process.env.GEECLAW_PLUGIN_CONFIG_PATH || undefined,
        });
        const hookProxy = new HookProxy(api);
        const fetchChain = new FetchChain();
        const gatewayRegistry = new GatewayRegistry(api);
        const httpRouteRegistry = new HttpRouteRegistry(api);
        const commandRegistry = new CommandRegistry(api);
        // 初始化伽利略遥测上报器
        const reporter = new GeeClawReporter();
        reporter.init({
            logger: api.logger ?? console,
            openclawVersion: api.runtime?.version ?? '',
        });
        // 获取其他 package 的公开 API
        const getPackageApi = (packageId) => {
            const pkg = initializedPackages.get(packageId);
            return pkg?.getPublicApi?.();
        };
        // 按顺序初始化所有 package
        for (const pkg of PACKAGES) {
            try {
                const ctx = createGeeClawContext({
                    api,
                    packageId: pkg.id,
                    hookProxy,
                    fetchChain,
                    configCenter,
                    gatewayRegistry,
                    httpRouteRegistry,
                    commandRegistry,
                    reporter,
                    getPackageApi,
                });
                // 调用 package 的 setup 方法
                const result = pkg.setup(ctx);
                // 支持异步 setup（但 register 本身是同步的，所以异步 setup 会在后台执行）
                if (result instanceof Promise) {
                    result.catch((err) => {
                        console.error(`${LOG_TAG} async setup failed for ${pkg.id}:`, err);
                    });
                }
                initializedPackages.set(pkg.id, pkg);
                console.log(`${LOG_TAG} ✓ ${pkg.id} initialized`);
            }
            catch (err) {
                console.error(`${LOG_TAG} ✗ ${pkg.id} setup failed:`, err);
            }
        }
        // ---- 注册非标 Hook 事件（不在 HookEvent 类型中的事件） ----
        // qmemory 需要 session_start / session_end 来管理任务生命周期，
        // 这些事件不被 HookProxy 支持，需要直接通过 api.on() 注册。
        const qmemoryApi = initializedPackages.get('qmemory')?.getPublicApi?.();
        if (qmemoryApi) {
            api.on('session_start', (_event, ctx) => {
                const hookCtx = ctx;
                if (hookCtx?.sessionKey && hookCtx?.agentId) {
                    qmemoryApi.onSessionStart(hookCtx.sessionKey, hookCtx.agentId);
                }
            });
            api.on('session_end', (_event, ctx) => {
                const hookCtx = ctx;
                if (hookCtx?.sessionKey) {
                    qmemoryApi.onSessionEnd(hookCtx.sessionKey);
                }
            });
            console.log(`${LOG_TAG} registered session_start/session_end hooks for qmemory`);
        }
        // 安装 FetchChain（无条件安装，支持 package 延迟注册中间件）
        fetchChain.install();
        console.log(`${LOG_TAG} initialized ${initializedPackages.size}/${PACKAGES.length} package(s)`);
    },
};
export default plugin;
