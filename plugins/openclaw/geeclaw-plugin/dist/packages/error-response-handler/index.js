/**
 * error-response-handler — HTTP 错误响应翻译
 *
 * 当 LLM 请求返回 HTTP 4xx/5xx 错误码（Token 耗尽、限流、服务不可用等），
 * 将错误码转换为标准 SSE 伪响应流中的友好文案，
 * 确保外部渠道（微信、企微、QQ、飞书、钉钉、元宝）能收到友好的错误提示，
 * 而不是静默无响应。
 *
 * 仅处理 HTTP 错误码翻译，不处理网络异常（由上层负责）。
 *
 * 实现方式：注册一个低 priority 的 FetchMiddleware，
 * 在 onResponse 阶段（洋葱模型逆序，最外层兜底）检测 HTTP 错误码。
 *
 * 错误提示文案固定使用本地静态兜底数据，不依赖外部配置服务。
 */
import { REPORT_CONST } from '../../core/reporter-constants.js';
// ─── 本地静态兜底数据 ───
const FALLBACK_ERROR_MESSAGES = {
    400: '模型服务未能处理当前请求（400），请稍后重试。',
    401: '模型服务认证失败（401），请检查所使用的服务是否可用。',
    403: '当前模型服务拒绝了本次请求（403），请检查服务状态或权限。',
    404: '当前模型服务接口不可用（404），请确认所使用的服务是否正常。',
    429: '当前模型服务请求较多（429），请稍后重试。',
    500: '模型服务暂时不可用（500），请稍后再试。',
    502: '模型服务暂时不可用（502），请稍后再试。',
    503: '模型服务当前繁忙（503），请稍后再试。',
};
// ─── 运行时可变的错误提示映射（初始为静态兜底） ───
let errorMessages = { ...FALLBACK_ERROR_MESSAGES };
// ─── 判断请求的 API 类型 ───
function toUrlString(input) {
    return typeof input === 'string' ? input : input.toString();
}
function isAnthropicMessagesUrl(input) {
    return toUrlString(input).includes('/v1/messages');
}
function isOpenAIUrl(input) {
    const url = toUrlString(input);
    return url.includes('/chat/completions') || url.includes('/v1/completions');
}
// ─── 构造标准 SSE 伪响应 ───
/**
 * 将文本包装为 SSE 格式的 Response。
 *
 * 根据请求 URL 路径判断 API 类型：
 * - /v1/messages → Anthropic message 格式（pi-ai 的 anthropic-messages 类型期望此格式）
 * - /chat/completions / /v1/completions → OpenAI chat.completion.chunk 格式
 *
 * 如果格式不匹配，pi-ai 在解析 SSE 流时会失败，抛出 "request ended without sending any chunks"。
 */
function buildSseErrorResponse(text, input) {
    if (isAnthropicMessagesUrl(input)) {
        // Anthropic Messages SSE 格式
        //
        // pi-ai SDK 解析流程（@mariozechner/pi-ai → anthropic.js）：
        //   1. message_start       → 初始化 output（content 数组为空）
        //   2. content_block_start  → push 空 block（text: ""），忽略 content_block.text
        //   3. content_block_delta  → block.text += delta.text（唯一写入文本的途径）
        //   4. content_block_stop   → push text_end 事件
        //   5. message_delta        → 更新 stop_reason 和 usage
        //   6. message_stop         → for-await 结束后 SDK 自动 push { type: "done" }
        const requestId = `error-handler-${Date.now()}`;
        const events = [
            // 1. message_start
            {
                event: 'message_start',
                data: {
                    type: 'message_start',
                    message: {
                        id: requestId,
                        type: 'message',
                        role: 'assistant',
                        content: [],
                        stop_reason: null,
                        stop_sequence: null,
                        usage: { input_tokens: 0, output_tokens: 0 },
                    },
                },
            },
            // 2. content_block_start（初始化空 text block）
            {
                event: 'content_block_start',
                data: {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'text', text: '' },
                },
            },
            // 3. content_block_delta（**传递实际文本**）
            {
                event: 'content_block_delta',
                data: {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: text },
                },
            },
            // 4. content_block_stop
            {
                event: 'content_block_stop',
                data: { type: 'content_block_stop', index: 0 },
            },
            // 5. message_delta（提供 stop_reason + usage）
            {
                event: 'message_delta',
                data: {
                    type: 'message_delta',
                    delta: { stop_reason: 'end_turn', stop_sequence: null },
                    usage: { output_tokens: 1, input_tokens: 0 },
                },
            },
            // 6. message_stop（触发 for-await 结束）
            {
                event: 'message_stop',
                data: { type: 'message_stop' },
            },
        ];
        const sseBody = events
            .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
            .join('');
        return new Response(new TextEncoder().encode(sseBody), {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    }
    // OpenAI chat.completion.chunk 格式（默认）
    const sseChunk = JSON.stringify({
        id: `error-handler-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'error-handler',
        choices: [{
                index: 0,
                delta: { role: 'assistant', content: text },
                finish_reason: 'stop',
            }],
    });
    const sseBody = `data: ${sseChunk}\n\ndata: [DONE]\n\n`;
    return new Response(new TextEncoder().encode(sseBody), {
        status: 200,
        statusText: 'OK',
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
// ─── FetchMiddleware 工厂 ───
function createErrorResponseMiddleware(logger, reporter) {
    return {
        id: 'error-response-handler',
        /**
         * priority 50：数字小 → onRequest 先执行、onResponse 后执行（洋葱模型逆序）。
         *
         * 在 onResponse 阶段，priority 50 排在 content-plugin(200) 和
         * pcmgr-ai-security(250) 之后执行，作为最外层兜底。
         * 如果上游中间件已经处理了错误（如 content-plugin 的 shortCircuit），
         * 则 response.ok 为 true，本中间件直接放行。
         */
        priority: 50,
        // 只拦截 LLM 聊天补全请求，避免干扰管家内部 API / 审核服务等请求
        match(input) {
            return isOpenAIUrl(input) || isAnthropicMessagesUrl(input);
        },
        /**
         * onResponse：检测 HTTP 错误码，转为友好 SSE 响应
         *
         * 只处理 !response.ok（4xx / 5xx）的情况，2xx 直接放行。
         * 从运行时 errorMessages 中读取提示文案。
         *
         * SSE 格式根据请求 URL 自动适配：
         * - /v1/messages → Anthropic message 格式
         * - /chat/completions / /v1/completions → OpenAI chat.completion.chunk 格式
         */
        async onResponse(ctx) {
            const { response, input } = ctx;
            const urlStr = toUrlString(input);
            // 2xx 正常响应，直接放行
            if (response.ok) {
                return response;
            }
            const status = response.status;
            const errorMsg = errorMessages[status] ?? `服务异常(${status})，请稍后重试`;
            const apiFormat = isAnthropicMessagesUrl(input) ? 'anthropic' : 'openai';
            logger.warn(`HTTP ${status} detected on ${urlStr.slice(0, 100)}, ` +
                `converting to ${apiFormat} SSE, text: "${errorMsg}"`);
            reporter.report(REPORT_CONST.INTERACTION_EVENT, {
                module_id: 'ErrorHandler',
                component_id: 'LLM_HTTP_Error',
                event_code: 'error_intercepted',
                action_type: 'http_error_to_sse',
                action_status: 'fail',
                statistics: {
                    http_status: status,
                    api_format: apiFormat,
                    url: urlStr.slice(0, 200),
                    error_message: errorMsg,
                },
            });
            return buildSseErrorResponse(errorMsg, input);
        },
    };
}
// ─── GeeClawPackage 定义 ───
const errorResponseHandler = {
    id: 'error-response-handler',
    name: '错误响应处理',
    description: '将 HTTP 错误码转换为标准 SSE 响应，确保外部渠道能收到友好提示',
    async setup(ctx) {
        // 注册中间件
        ctx.registerFetchMiddleware(createErrorResponseMiddleware(ctx.logger, ctx.reporter));
        ctx.logger.info('Initialized with local fallback messages only');
    },
    teardown() {
        // 重置为静态兜底数据
        errorMessages = { ...FALLBACK_ERROR_MESSAGES };
    },
};
export default errorResponseHandler;
