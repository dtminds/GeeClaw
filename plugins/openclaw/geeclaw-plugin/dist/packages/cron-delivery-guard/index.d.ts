/**
 * cron-delivery-guard — 定时任务投递守护 Package v3.2.0
 *
 * 通过 message_received / before_tool_call / after_tool_call 钩子实现四项功能：
 *
 * 1. 渠道默认投递目标自动记录（message_received）
 *    触发条件：外部渠道（非 webchat/last）收到消息
 *    作用：解析 channel / accountId / to，通过 bindings 反查 agentId，
 *    写入 {stateDir}/channel-defaults.json（以 agentId + channel + accountId 为维度存储）。
 *
 * 2. channel/to 自动补全（before_tool_call）
 *    触发条件：cron 工具调用的 delivery 缺少 channel 或 to
 *    作用：从 hookCtx.sessionKey 解析外部渠道信息（channel、peerid 等），
 *    自动注入到 delivery 中，确保 LLM 忘传 channel/to 时仍能正确投递。
 *
 * 3. bestEffort 自动注入（before_tool_call）
 *    - mode=none -> 强制改为 mode=announce + bestEffort=true
 *    - mode=announce + channel 为空/webchat/last -> 注入 bestEffort=true
 *    作用：投递失败时静默降级，不影响 cron 执行结果的保存。
 *
 * 4. cron add 后兜底写入 + 上报（after_tool_call）
 *    触发条件：cron add 调用完成
 *    - 失败时：上报创建失败埋点
 *    - 成功时：delivery 有外部渠道 + 有 to 时兜底写入 channel-defaults.json
 *
 * channel-defaults.json 格式（以 agentId + channel + accountId 为 key，联动 openclaw.json bindings）：
 *   {
 *     "main": {
 *       "wecom": {
 *         "default": { "to": "T48250041A" },
 *         "work": { "to": "T9ABCDEFG" }
 *       }
 *     },
 *     "agent-sales": {
 *       "telegram": {
 *         "personal": { "to": "123456" }
 *       }
 *     }
 *   }
 * 向后兼容：读取时如果检测到旧格式，自动迁移到 default account。
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
 * 判断是否为 cron 工具调用（所有操作）。
 * 保留该导出以兼容既有测试和外部使用方。
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
 * sessionKey 中解析出的渠道投递信息
 */
export interface SessionChannelInfo {
    channel: string;
    to: string;
}
/**
 * 从 sessionKey 中解析外部渠道和投递目标。
 *
 * 支持三种格式：
 * 1. agent:main:openai-user:{"channel":"dingtalk-connector","peerid":"xxx",...}
 *    -> channel=dingtalk-connector, to=peerid
 * 2. agent:main:dingtalk-connector:{"accountid":"xxx","peerid":"xxx",...}
 *    -> channel=dingtalk-connector, to=peerid
 * 3. agent:main:wechat-access:direct:{userId}
 *    -> channel=wechat-access, to=userId
 *
 * 返回 null 表示无法解析（本地 session 或格式不匹配）。
 */
export declare function parseSessionKeyChannel(sessionKey: string | undefined): SessionChannelInfo | null;
/**
 * 深拷贝 params，为缺失 channel/to 的 delivery 注入从 sessionKey 解析出的值。
 * 仅在 delivery.channel 或 delivery.to 缺失时注入，不覆盖 LLM 已传入的值。
 */
export declare function injectChannelAndTo(params: Record<string, unknown>, info: SessionChannelInfo): Record<string, unknown>;
/**
 * 深拷贝 params 并注入 bestEffort: true
 */
export declare function injectBestEffort(params: Record<string, unknown>): Record<string, unknown>;
/**
 * 深拷贝 params，将 mode 改为 announce 并注入 bestEffort: true。
 * 用于 mode=none 场景：保留投递能力，同时允许失败静默降级。
 */
export declare function injectAnnounceWithBestEffort(params: Record<string, unknown>): Record<string, unknown>;
/**
 * 从 OpenClaw 配置的 bindings 中反查 agentId。
 *
 * message_received 钩子的 hookCtx 不携带 agentId，
 * 因此需要利用 config.bindings 的 channel 匹配来确定消息归属的 agent。
 */
export declare function resolveAgentIdFromBindings(config: Record<string, unknown>, channel: string): string | undefined;
/** 单条渠道默认投递目标 */
export interface ChannelDefaultEntry {
    to: string;
}
/**
 * 当前格式：以 agentId 为 key，每个 agent 下按 channel + accountId 存储 { to }
 *   { "main": { "wecom": { "default": { "to": "xxx" } } } }
 *
 * v1 旧格式：扁平 Record<string, string>
 *   { "wecom": "xxx" }
 *
 * v2 旧格式：以 agentId + channel 存储 { to }
 *   { "main": { "wecom": { "to": "xxx" } } }
 */
export type ChannelDefaults = Record<string, Record<string, Record<string, ChannelDefaultEntry>>>;
/**
 * 将 agentId -> channel -> accountId -> { to } 映射写入 {stateDir}/channel-defaults.json。
 * 不碰 openclaw.json，避免触发热重载。
 * 若已存在且值相同则跳过，不重复写入。
 */
export declare function persistChannelDefault(stateDir: string, channel: string, accountId: string, to: string, agentId?: string): void;
export declare function extractAccountId(params: Record<string, unknown>): string;
/**
 * 从 metadata.to / from 字段提取纯 to 值，去掉 "{channel}:" 前缀。
 */
export declare function extractTo(channel: string, metadataTo: string | undefined, from: string | undefined): string;
declare const cronDeliveryGuard: GeeClawPackage;
export default cronDeliveryGuard;
