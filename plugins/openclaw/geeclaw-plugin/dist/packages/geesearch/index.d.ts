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
export declare function parseGeeSearchConfig(raw: unknown): GeeSearchConfig;
export declare function createGeeSearchProvider(config: GeeSearchConfig): WebSearchProviderDefinition;
declare const geesearchPkg: GeeClawPackage;
export default geesearchPkg;
