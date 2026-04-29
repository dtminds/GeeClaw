/**
 * geesearch — GeeClaw web_search provider
 *
 * 按 GeeClaw /web_search API 发起正式搜索请求。
 */
import type { GeeClawPackage, WebSearchProviderDefinition } from '../../core/types.js';
export type GeeSearchAuthType = 'api-key' | 'bearer';
export type GeeSearchContentSize = 'medium' | 'high';
export type GeeSearchRecencyFilter = 'noLimit' | 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear';
export interface GeeSearchConfig {
    enabled: boolean;
    baseUrl: string;
    apiKey?: string;
    authType: GeeSearchAuthType;
    model: string;
    intent: boolean;
    contentSize: GeeSearchContentSize;
    timeoutSeconds: number;
    maxResults: number;
}
type GeeSearchErrorCode = 'missing_api_key' | 'invalid_base_url' | 'timeout' | 'api_error' | 'network_error';
export declare class GeeSearchError extends Error {
    readonly code: GeeSearchErrorCode;
    readonly cause?: unknown;
    constructor(code: GeeSearchErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
export declare function parseGeeSearchConfig(raw: unknown): GeeSearchConfig;
export declare function createGeeSearchProvider(config: GeeSearchConfig): WebSearchProviderDefinition;
declare const geesearchPkg: GeeClawPackage;
export default geesearchPkg;
