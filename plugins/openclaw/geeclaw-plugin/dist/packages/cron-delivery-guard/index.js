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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { REPORT_CONST } from '../../core/reporter-constants.js';
/** 主 agent 的 ID */
const MAIN_AGENT_ID = 'main';
/** 默认账号 ID */
const DEFAULT_ACCOUNT_ID = 'default';
/**
 * 本地渠道标识：不写 channel-defaults，cron 任务注入 bestEffort。
 */
const LOCAL_CHANNELS = new Set(['webchat', 'last', '']);
// ---- 纯函数（已 export，可独立测试） ----
/**
 * 判断是否为 cron 工具调用（所有操作）。
 * 保留该导出以兼容既有测试和外部使用方。
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
    if (params.delivery && typeof params.delivery === 'object') {
        return params.delivery;
    }
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
 * 已知外部渠道标识（与 LOCAL_CHANNELS 互斥）
 */
const KNOWN_EXTERNAL_CHANNELS = new Set([
    'wechat-access',
    'openclaw-weixin',
    'wecom',
    'feishu',
    'dingtalk-connector',
    'qqbot',
]);
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
export function parseSessionKeyChannel(sessionKey) {
    if (!sessionKey)
        return null;
    const parts = sessionKey.split(':');
    if (parts.length < 3)
        return null;
    const thirdPart = parts[2] || '';
    const jsonStart = sessionKey.indexOf('{');
    if (jsonStart !== -1) {
        try {
            const json = JSON.parse(sessionKey.slice(jsonStart));
            const channel = json.channel || thirdPart;
            if (!channel || !KNOWN_EXTERNAL_CHANNELS.has(channel))
                return null;
            const to = json.peerid ||
                json.peerId ||
                json.to ||
                json.senderid ||
                json.senderId ||
                json.from ||
                '';
            if (!to)
                return null;
            return { channel, to };
        }
        catch {
            // JSON 解析失败，继续后续逻辑
        }
    }
    if (KNOWN_EXTERNAL_CHANNELS.has(thirdPart) && parts.length >= 5) {
        const to = parts.slice(4).join(':');
        if (!to)
            return null;
        return { channel: thirdPart, to };
    }
    return null;
}
/**
 * 深拷贝 params，为缺失 channel/to 的 delivery 注入从 sessionKey 解析出的值。
 * 仅在 delivery.channel 或 delivery.to 缺失时注入，不覆盖 LLM 已传入的值。
 */
export function injectChannelAndTo(params, info) {
    const newParams = JSON.parse(JSON.stringify(params));
    if (newParams.delivery && typeof newParams.delivery === 'object') {
        const d = newParams.delivery;
        if (!d.channel)
            d.channel = info.channel;
        if (!d.to)
            d.to = info.to;
        return newParams;
    }
    const job = newParams.job;
    if (job?.delivery && typeof job.delivery === 'object') {
        const d = job.delivery;
        if (!d.channel)
            d.channel = info.channel;
        if (!d.to)
            d.to = info.to;
        return newParams;
    }
    return newParams;
}
/**
 * 深拷贝 params 并注入 bestEffort: true
 */
export function injectBestEffort(params) {
    const newParams = JSON.parse(JSON.stringify(params));
    if (newParams.delivery && typeof newParams.delivery === 'object') {
        ;
        newParams.delivery.bestEffort = true;
        return newParams;
    }
    const job = newParams.job;
    if (job?.delivery && typeof job.delivery === 'object') {
        ;
        job.delivery.bestEffort = true;
        return newParams;
    }
    return newParams;
}
/**
 * 深拷贝 params，将 mode 改为 announce 并注入 bestEffort: true。
 * 用于 mode=none 场景：保留投递能力，同时允许失败静默降级。
 */
export function injectAnnounceWithBestEffort(params) {
    const newParams = JSON.parse(JSON.stringify(params));
    if (newParams.delivery && typeof newParams.delivery === 'object') {
        ;
        newParams.delivery.mode = 'announce';
        newParams.delivery.bestEffort = true;
        return newParams;
    }
    const job = newParams.job;
    if (job?.delivery && typeof job.delivery === 'object') {
        ;
        job.delivery.mode = 'announce';
        job.delivery.bestEffort = true;
        return newParams;
    }
    return newParams;
}
/**
 * 从 OpenClaw 配置的 bindings 中反查 agentId。
 *
 * message_received 钩子的 hookCtx 不携带 agentId，
 * 因此需要利用 config.bindings 的 channel 匹配来确定消息归属的 agent。
 */
export function resolveAgentIdFromBindings(config, channel) {
    const bindings = config.bindings;
    if (!Array.isArray(bindings) || bindings.length === 0)
        return undefined;
    for (const b of bindings) {
        const m = b.match;
        if (!m || m.channel !== channel)
            continue;
        return b.agentId || undefined;
    }
    return undefined;
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isChannelDefaultEntry(value) {
    return isRecord(value) && typeof value.to === 'string';
}
/**
 * 检测是否为 v1 旧格式（扁平 Record<string, string>）。
 */
function isV1Format(data) {
    if (!isRecord(data))
        return false;
    const values = Object.values(data);
    if (values.length === 0)
        return false;
    return values.every((v) => typeof v === 'string');
}
/**
 * 将 v1 旧格式迁移为当前格式，所有条目归入 "main" agent 和 default account。
 */
function migrateV1ToCurrent(v1) {
    const defaults = {};
    const mainDefaults = {};
    for (const [channel, to] of Object.entries(v1)) {
        mainDefaults[channel] = {
            [DEFAULT_ACCOUNT_ID]: { to },
        };
    }
    if (Object.keys(mainDefaults).length > 0) {
        defaults[MAIN_AGENT_ID] = mainDefaults;
    }
    return defaults;
}
/**
 * 将 v2 或当前格式规范化到当前格式。
 * v2 的 channel 级 { to } 会迁移到 default account。
 */
function normalizeChannelDefaults(raw) {
    if (isV1Format(raw))
        return migrateV1ToCurrent(raw);
    if (!isRecord(raw))
        return {};
    const defaults = {};
    for (const [agentId, channels] of Object.entries(raw)) {
        if (!isRecord(channels))
            continue;
        const agentDefaults = {};
        for (const [channel, value] of Object.entries(channels)) {
            if (isChannelDefaultEntry(value)) {
                agentDefaults[channel] = {
                    [DEFAULT_ACCOUNT_ID]: { to: value.to },
                };
                continue;
            }
            if (!isRecord(value))
                continue;
            const accountDefaults = {};
            for (const [accountId, entry] of Object.entries(value)) {
                if (isChannelDefaultEntry(entry)) {
                    accountDefaults[accountId] = { to: entry.to };
                }
            }
            if (Object.keys(accountDefaults).length > 0) {
                agentDefaults[channel] = accountDefaults;
            }
        }
        if (Object.keys(agentDefaults).length > 0) {
            defaults[agentId] = agentDefaults;
        }
    }
    return defaults;
}
/**
 * 将 agentId -> channel -> accountId -> { to } 映射写入 {stateDir}/channel-defaults.json。
 * 不碰 openclaw.json，避免触发热重载。
 * 若已存在且值相同则跳过，不重复写入。
 */
export function persistChannelDefault(stateDir, channel, accountId, to, agentId) {
    const resolvedDir = stateDir || path.join(os.homedir(), '.openclaw-geeclaw');
    const filePath = path.join(resolvedDir, 'channel-defaults.json');
    const effectiveAgentId = agentId || MAIN_AGENT_ID;
    const effectiveAccountId = accountId || DEFAULT_ACCOUNT_ID;
    try {
        fs.mkdirSync(resolvedDir, { recursive: true });
        let defaults = {};
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            defaults = normalizeChannelDefaults(raw);
        }
        const agentDefaults = defaults[effectiveAgentId] || {};
        const channelDefaults = agentDefaults[channel] || {};
        const existing = channelDefaults[effectiveAccountId];
        if (existing && existing.to === to) {
            return;
        }
        channelDefaults[effectiveAccountId] = { to };
        agentDefaults[channel] = channelDefaults;
        defaults[effectiveAgentId] = agentDefaults;
        fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf-8');
    }
    catch {
        // best-effort，写入失败不影响主流程
    }
}
export function extractAccountId(params) {
    const job = params.job;
    const delivery = extractDelivery(params);
    const accountId = params.accountId ?? job?.accountId ?? delivery?.accountId;
    return typeof accountId === 'string' && accountId ? accountId : DEFAULT_ACCOUNT_ID;
}
/**
 * 从 metadata.to / from 字段提取纯 to 值，去掉 "{channel}:" 前缀。
 */
export function extractTo(channel, metadataTo, from) {
    const prefix = `${channel}:`;
    if (metadataTo) {
        return metadataTo.startsWith(prefix) ? metadataTo.slice(prefix.length) : metadataTo;
    }
    if (!from)
        return '';
    return from.startsWith(prefix) ? from.slice(prefix.length) : from;
}
function loadRuntimeConfig(ctx) {
    return ctx.runtime.getConfig?.() ?? ctx.runtime.config ?? {};
}
// ---- Package 定义 ----
const cronDeliveryGuard = {
    id: 'cron-delivery-guard',
    name: 'Cron 投递降级守卫',
    description: 'message_received 记录外部渠道 channel-defaults; before_tool_call mode=none 强转 announce+bestEffort / 本地渠道注入 bestEffort; after_tool_call 兜底写入 + 失败上报',
    configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
    },
    setup(ctx) {
        ctx.logger.info('setup');
        // ---- message_received: 记录外部渠道默认投递目标 ----
        ctx.onHook('message_received', async (event, hookCtx) => {
            const msgEvent = event;
            const msgCtx = hookCtx;
            const channel = msgCtx.channelId ?? '';
            const accountId = msgCtx.accountId ?? DEFAULT_ACCOUNT_ID;
            if (LOCAL_CHANNELS.has(channel))
                return undefined;
            const to = extractTo(channel, msgEvent.metadata?.to, msgEvent.from);
            if (!to) {
                ctx.logger.info('message_received: no "to" resolved, skip.');
                return undefined;
            }
            const liveConfig = loadRuntimeConfig(ctx);
            const agentId = resolveAgentIdFromBindings(liveConfig, channel);
            persistChannelDefault(ctx.runtime.stateDir, channel, accountId, to, agentId);
            ctx.logger.info(`message_received: persisted channel=${channel} accountId=${accountId} to=${to} agentId=${agentId ?? MAIN_AGENT_ID}`);
            return undefined;
        });
        // ---- before_tool_call: channel/to 自动注入 + mode=none 强转 + bestEffort 注入 ----
        ctx.onHook('before_tool_call', async (event, hookCtx) => {
            const toolName = event.toolName;
            let params = event.params;
            const toolCallId = event.toolCallId;
            if (!isCronTool(toolName))
                return undefined;
            const delivery = extractDelivery(params);
            if (!delivery) {
                ctx.logger.info(`cron call (${toolCallId}) has no delivery, skip.`);
                return undefined;
            }
            let modified = false;
            if (!delivery.channel || !delivery.to) {
                const sessionInfo = parseSessionKeyChannel(hookCtx.sessionKey);
                if (sessionInfo) {
                    params = injectChannelAndTo(params, sessionInfo);
                    const injectedParts = [];
                    if (!delivery.channel)
                        injectedParts.push(`channel=${sessionInfo.channel}`);
                    if (!delivery.to)
                        injectedParts.push(`to=${sessionInfo.to}`);
                    ctx.logger.info(`cron call (${toolCallId}) auto-injected from sessionKey: ${injectedParts.join(', ')}`);
                    modified = true;
                }
            }
            const currentDelivery = modified ? extractDelivery(params) ?? delivery : delivery;
            const mode = currentDelivery.mode ?? '';
            const channel = currentDelivery.channel ?? '';
            if (mode === 'none') {
                const newParams = injectAnnounceWithBestEffort(params);
                ctx.logger.info(`cron call (${toolCallId}) mode=none -> announce+bestEffort`);
                return { params: newParams };
            }
            if (mode === 'announce' && !currentDelivery.bestEffort && LOCAL_CHANNELS.has(channel)) {
                const newParams = injectBestEffort(params);
                ctx.logger.info(`cron call (${toolCallId}) injected bestEffort=true (channel=${channel})`);
                return { params: newParams };
            }
            if (modified) {
                ctx.logger.info(`cron call (${toolCallId}) returning channel/to injected params (mode=${mode}, channel=${channel})`);
                return { params };
            }
            ctx.logger.info(`cron call (${toolCallId}) no injection needed (mode=${mode}, channel=${channel}, bestEffort=${String(currentDelivery.bestEffort)})`);
            return undefined;
        }, { priority: 400 });
        // ---- after_tool_call: cron add 成功后写入 channel-defaults ----
        ctx.onHook('after_tool_call', async (event, hookCtx) => {
            const toolName = event.toolName;
            const params = event.params;
            const toolCallId = event.toolCallId;
            if (!isCronAdd(toolName, params)) {
                return undefined;
            }
            if (event.isError) {
                const delivery = extractDelivery(params);
                ctx.reporter.report(REPORT_CONST.PLUGIN, {
                    module_id: 'task_creation',
                    component_id: 'task_creation',
                    event_code: 'e_abc122eb_mc',
                    action_type: 'click',
                    action_status: 'fail',
                    statistics: {
                        agent_id: hookCtx.agentId ?? '',
                        session_key: hookCtx.sessionKey ?? '',
                        channel: delivery?.channel || '',
                        mode: delivery?.mode || 'none',
                        to: delivery?.to || '',
                        best_effort: String(delivery?.bestEffort ?? false),
                        fail_reason: String(event.result ?? '').slice(0, 200),
                    },
                });
                ctx.logger.info(`after_tool_call: cron add (${toolCallId}) FAILED, reported`);
                return undefined;
            }
            const delivery = extractDelivery(params);
            if (!delivery || !hasExternalChannel(delivery) || !delivery.to) {
                return undefined;
            }
            const channel = delivery.channel;
            const accountId = extractAccountId(params);
            const to = delivery.to;
            const agentId = hookCtx.agentId ?? MAIN_AGENT_ID;
            persistChannelDefault(ctx.runtime.stateDir, channel, accountId, to, agentId);
            ctx.logger.info(`after_tool_call: cron add (${toolCallId}) persisted agentId=${agentId} channel=${channel} accountId=${accountId} to=${to}`);
            return undefined;
        }, { priority: 400 });
    },
};
export default cronDeliveryGuard;
