/**
 * shared/message-utils.ts — 消息处理公共工具函数
 *
 * 从 content-plugin 和 pcmgr-ai-security 提取的公共消息处理逻辑。
 *
 * 导出两个版本的 extractLastUserMessage：
 * - extractLastUserMessage：含 isToolResultMessage 过滤（content-plugin 使用）
 * - robustExtractLastUserMessage：不含过滤（pcmgr-ai-security 使用，保持原有行为）
 */
/** 标准化后的消息结构 */
export interface NormalizedMessage {
    role: string;
    content: string;
}
/**
 * 将 OpenAI/其他格式的消息标准化为 { role, content } 结构。
 *
 * - OpenAI 字符串格式：直接提取 content
 * - OpenAI 多模态格式：提取所有 type=text 的部分，用换行拼接
 * - 非 OpenAI 格式：content 直接转为字符串
 */
export declare const normalizeMessage: (message: any, format?: string) => NormalizedMessage;
/**
 * 提取请求体中最后一条用户消息（含 isToolResultMessage 过滤）。
 *
 * 工具结果回传不是真实用户输入，会被跳过。
 * 适用于 content-plugin / content-security 的安全审核场景。
 */
export declare const extractLastUserMessage: (body: any) => NormalizedMessage[];
/**
 * 提取请求体中最后一条用户消息（不含 isToolResultMessage 过滤）。
 *
 * 保持 pcmgr-ai-security 的原有行为：不跳过工具结果回传。
 * 适用于 pcmgr-ai-security 的 Prompt 安全检测场景。
 */
export declare const robustExtractLastUserMessage: (body: any) => NormalizedMessage[];
