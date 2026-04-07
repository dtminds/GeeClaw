/**
 * core/reporter-utils.ts — 伽利略遥测上报工具函数
 *
 * 从 claw-plugin-report/util.ts 迁移，所有函数均为纯函数，可独立测试。
 */
/**
 * 为上报参数添加统一前缀（如 PC_GeeClaw_name, PC_GeeClaw_guid）
 *
 * @param options - 原始参数
 * @returns 带前缀的参数
 */
export declare function addGeeClawPrefix(options: Record<string, unknown>): Record<string, unknown>;
/**
 * 根据平台和架构生成上报用的平台标识
 *
 * - Windows → GeeClaw_Win
 * - macOS ARM → GeeClaw_MAC_ARM
 * - macOS Intel → GeeClaw_MAC_INTEL
 */
export declare function getDevicePlatform(info: {
    platform: string;
    arch: string;
}): string;
/**
 * 生成 UUID v4 格式的 ID
 */
export declare function generateUUID(): string;
/**
 * 生成指定长度的十六进制 ID
 */
export declare function generateId(length?: number): string;
/**
 * 安全 JSON 序列化
 */
export declare function safeStringify(obj: unknown): string;
