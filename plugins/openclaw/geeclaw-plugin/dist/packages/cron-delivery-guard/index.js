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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
/** 主 agent 的 ID */
const MAIN_AGENT_ID = 'main';
/** 本地渠道标识，不属于外部通道 */
const LOCAL_CHANNELS = new Set(['webchat', 'last', '']);
// ---- 纯函数（已 export，可独立测试） ----
/**
 * 判断是否为 cron 工具调用（所有操作）
 */
export function isCronTool(toolName) {
    return toolName === 'cron';
}
/**
 * 判断是否为 cron add 工具调用（仅拦截创建操作）
 */
export function isCronAdd(toolName, params) {
    if (toolName !== 'cron')
        return false;
    const action = params.action;
    return action === 'add' || action === undefined; // 兼容无 action 字段的旧格式
}
/**
 * 从 cron 参数中提取 delivery 配置
 * cron 工具的参数结构可能是:
 * - params.delivery (顶层)
 * - params.job.delivery (嵌套在 job 中)
 */
export function extractDelivery(params) {
    // 尝试顶层 delivery
    if (params.delivery && typeof params.delivery === 'object') {
        return params.delivery;
    }
    // 尝试 job.delivery
    const job = params.job;
    if (job?.delivery && typeof job.delivery === 'object') {
        return job.delivery;
    }
    return null;
}
/**
 * 判断 delivery 是否有外部渠道（非本地）
 */
export function hasExternalChannel(delivery) {
    const channel = delivery.channel ?? '';
    return !LOCAL_CHANNELS.has(channel);
}
/**
 * 深拷贝 params 并注入 bestEffort: true
 */
export function injectBestEffort(params) {
    const newParams = JSON.parse(JSON.stringify(params));
    // 顶层 delivery
    if (newParams.delivery && typeof newParams.delivery === 'object') {
        ;
        newParams.delivery.bestEffort = true;
        return newParams;
    }
    // job.delivery
    const job = newParams.job;
    if (job?.delivery && typeof job.delivery === 'object') {
        ;
        job.delivery.bestEffort = true;
        return newParams;
    }
    return newParams;
}
/**
 * 将 channel → to 映射写入 {stateDir}/channel-defaults.json。
 * 不碰 openclaw.json，避免触发热重载。
 * 若已存在且值相同则跳过，不重复写入。
 */
export function persistChannelDefault(stateDir, channel, to) {
    // stateDir 为空时 fallback 到 ~/.geeclaw
    const resolvedDir = stateDir || path.join(os.homedir(), '.geeclaw');
    const filePath = path.join(resolvedDir, 'channel-defaults.json');
    try {
        let defaults = {};
        if (fs.existsSync(filePath)) {
            defaults = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        if (defaults[channel] === to) {
            return;
        }
        defaults[channel] = to;
        fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf-8');
    }
    catch {
        // best-effort，写入失败不影响主流程
    }
}
/**
 * 从 from 字段提取纯 to 值，去掉 "{channel}:" 前缀。
 * 例如：
 *   channel=wecom, from="wecom:T48250041A"  → "T48250041A"
 *   channel=feishu, metadata.to="user:ou_x" → "user:ou_x"（优先取 metadata.to）
 */
export function extractTo(channel, metadataTo, from) {
    if (metadataTo)
        return metadataTo;
    if (!from)
        return '';
    const prefix = `${channel}:`;
    return from.startsWith(prefix) ? from.slice(prefix.length) : from;
}
// ---- Package 定义 ----
const cronDeliveryGuard = {
    id: 'cron-delivery-guard',
    name: 'Cron 投递降级守卫',
    description: '拦截 cron 工具调用：非主 agent 或无外部渠道时自动注入 bestEffort; 非主 agent 创建外部渠道任务时追加引导提示; 自动记录外部渠道 to 值到 channel-defaults.json',
    configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
    },
    setup(ctx) {
        ctx.logger.info('setup');
        // ---- message_received: 记录外部渠道默认投递目标 ----
        // HookEvent 类型不含 message_received，使用类型断言
        ctx.onHook('message_received', async (event, hookCtx) => {
            const msgEvent = event;
            const msgCtx = hookCtx;
            const channel = msgCtx.channelId ?? '';
            const to = extractTo(channel, msgEvent.metadata?.to, msgEvent.from);
            ctx.logger.info(`message_received: channel=${channel} to=${to} accountId=${msgCtx.accountId ?? ''}`);
            if (LOCAL_CHANNELS.has(channel)) {
                return undefined;
            }
            if (!to) {
                ctx.logger.info('message_received: no "to" field, skip.');
                return undefined;
            }
            persistChannelDefault(ctx.runtime.stateDir, channel, to);
            ctx.logger.info(`message_received: persisted channel=${channel} to=${to}`);
            return undefined;
        });
        // ---- before_tool_call: 注入 bestEffort ----
        ctx.onHook('before_tool_call', async (event, hookCtx) => {
            const toolName = event.toolName;
            const params = event.params;
            const toolCallId = event.toolCallId;
            if (!isCronTool(toolName)) {
                return undefined;
            }
            const delivery = extractDelivery(params);
            if (!delivery) {
                ctx.logger.info(`cron call (${toolCallId}) has no delivery config, skip.`);
                return undefined;
            }
            const agentId = hookCtx.agentId ?? MAIN_AGENT_ID;
            const isNonMainAgent = agentId !== MAIN_AGENT_ID;
            const shouldInject = delivery.mode === 'announce' &&
                !delivery.bestEffort &&
                (isNonMainAgent ||
                    !delivery.channel ||
                    delivery.channel === 'webchat' ||
                    delivery.channel === 'last');
            if (!shouldInject) {
                ctx.logger.info(`cron call (${toolCallId}) does not need bestEffort ` +
                    `(agentId=${agentId}, mode=${String(delivery.mode)}, channel=${String(delivery.channel)}, bestEffort=${String(delivery.bestEffort)}), skip.`);
                return undefined;
            }
            const newParams = injectBestEffort(params);
            ctx.logger.info(`cron call (${toolCallId}) injected bestEffort=true ` +
                `(agentId=${agentId}, mode=announce). delivery=${JSON.stringify(newParams.delivery || newParams.job?.delivery)}`);
            return { params: newParams };
        }, { priority: 400 });
        // ---- after_tool_call: 非主 agent 创建外部渠道 cron 时注入提示 ----
        ctx.onHook('after_tool_call', async (event, hookCtx) => {
            const toolName = event.toolName;
            const params = event.params;
            const toolCallId = event.toolCallId;
            const result = event.result;
            if (!isCronAdd(toolName, params)) {
                return undefined;
            }
            const agentId = hookCtx.agentId ?? MAIN_AGENT_ID;
            const delivery = extractDelivery(params);
            if (agentId === MAIN_AGENT_ID || !delivery || !hasExternalChannel(delivery)) {
                return undefined;
            }
            ctx.logger.info(`after cron add (${toolCallId}) from non-main agent "${agentId}", injecting reminder into result.`);
            const REMINDER = '\n\n> 💡 如需将定时任务消息推送到其他远控通道，请在GeeClaw Agent中创建定时任务。';
            if (typeof result === 'string') {
                return { result: result + REMINDER };
            }
            if (result && typeof result === 'object') {
                const resultObj = result;
                if (typeof resultObj.content === 'string') {
                    return { result: { ...resultObj, content: resultObj.content + REMINDER } };
                }
                return {
                    result: {
                        ...resultObj,
                        _hint: '如需将定时任务消息推送到其他远控通道，请在GeeClaw Agent 中创建定时任务。',
                    },
                };
            }
            return undefined;
        }, { priority: 400 });
    },
};
export default cronDeliveryGuard;
