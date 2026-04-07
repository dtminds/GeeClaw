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
import type { OpenClawPluginApi } from './core/types.js';
declare const plugin: {
    id: string;
    name: string;
    description: string;
    configSchema: {
        type: "object";
        additionalProperties: false;
        properties: {};
    };
    register(api: OpenClawPluginApi): void;
};
export default plugin;
