/**
 * cron-delivery-guard — 定时任务投递守护 Package v2.1.0
 *
 * 通过 before_tool_call / after_tool_call / message_received 钩子实现三项功能：
 *
 * 1. bestEffort 自动注入（before_tool_call）
 *    触发条件：delivery.mode === "announce" 且满足以下任一：
 *    - 无外部渠道（channel 为空、webchat、last）→ 适用所有 agent
 *    - 当前是非主 agent（agentId !== "main"）→ 无论是否有外部渠道，一律注入
 *    作用：投递失败时静默降级，不影响 cron 执行结果的保存。
 *
 * 2. 非主 agent 外部渠道提示注入（after_tool_call）
 *    触发条件：cron add + 非主 agent + delivery 有外部渠道
 *    作用：cron 正常创建，但在工具结果中追加提示。
 *
 * 3. 渠道默认投递目标自动记录（message_received）
 *    触发条件：外部渠道（非 webchat/last）收到消息
 *    作用：将 channel → to 的映射写入 {stateDir}/channel-defaults.json，
 *    供客户端会话创建外部渠道 cron 时读取。
 *
 * 迁移自: extensions/cron-delivery-guard/index.ts
 */
import type { GeeClawPackage } from '../../core/types.js';
export interface CronDelivery {
    mode?: string;
    channel?: string;
    to?: string;
    bestEffort?: boolean;
    [key: string]: unknown;
}
export interface MessageReceivedEvent {
    from?: string;
    content?: unknown;
    metadata?: {
        to?: string;
        senderId?: string;
        originatingTo?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface MessageReceivedContext {
    channelId?: string;
    accountId?: string;
    conversationId?: string;
    [key: string]: unknown;
}
/**
 * 判断是否为 cron 工具调用（所有操作）
 */
export declare function isCronTool(toolName: string): boolean;
/**
 * 判断是否为 cron add 工具调用（仅拦截创建操作）
 */
export declare function isCronAdd(toolName: string, params: Record<string, unknown>): boolean;
/**
 * 从 cron 参数中提取 delivery 配置
 * cron 工具的参数结构可能是:
 * - params.delivery (顶层)
 * - params.job.delivery (嵌套在 job 中)
 */
export declare function extractDelivery(params: Record<string, unknown>): CronDelivery | null;
/**
 * 判断 delivery 是否有外部渠道（非本地）
 */
export declare function hasExternalChannel(delivery: CronDelivery): boolean;
/**
 * 深拷贝 params 并注入 bestEffort: true
 */
export declare function injectBestEffort(params: Record<string, unknown>): Record<string, unknown>;
/**
 * 将 channel → to 映射写入 {stateDir}/channel-defaults.json。
 * 不碰 openclaw.json，避免触发热重载。
 * 若已存在且值相同则跳过，不重复写入。
 */
export declare function persistChannelDefault(stateDir: string, channel: string, to: string): void;
/**
 * 从 from 字段提取纯 to 值，去掉 "{channel}:" 前缀。
 * 例如：
 *   channel=wecom, from="wecom:T48250041A"  → "T48250041A"
 *   channel=feishu, metadata.to="user:ou_x" → "user:ou_x"（优先取 metadata.to）
 */
export declare function extractTo(channel: string, metadataTo: string | undefined, from: string | undefined): string;
declare const cronDeliveryGuard: GeeClawPackage;
export default cronDeliveryGuard;
