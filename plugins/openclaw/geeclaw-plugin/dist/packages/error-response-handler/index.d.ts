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
import type { GeeClawPackage } from '../../core/types.js';
declare const errorResponseHandler: GeeClawPackage;
export default errorResponseHandler;
