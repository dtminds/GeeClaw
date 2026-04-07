/**
 * core/reporter-utils.ts — 伽利略遥测上报工具函数
 *
 * 从 claw-plugin-report/util.ts 迁移，所有函数均为纯函数，可独立测试。
 */
import { DEFAULT_APPKEY } from './reporter-constants.js';
/**
 * 为上报参数添加统一前缀（如 PC_GeeClaw_name, PC_GeeClaw_guid）
 *
 * @param options - 原始参数
 * @returns 带前缀的参数
 */
export function addGeeClawPrefix(options) {
    const params = {};
    for (const key of Object.keys(options)) {
        params[`${DEFAULT_APPKEY}_${key}`] = options[key];
    }
    return params;
}
/**
 * 根据平台和架构生成上报用的平台标识
 *
 * - Windows → GeeClaw_Win
 * - macOS ARM → GeeClaw_MAC_ARM
 * - macOS Intel → GeeClaw_MAC_INTEL
 */
export function getDevicePlatform(info) {
    if (info.platform === 'win32')
        return 'GeeClaw_Win';
    if (info.platform === 'darwin') {
        return info.arch === 'arm64' ? 'GeeClaw_MAC_ARM' : 'GeeClaw_MAC_INTEL';
    }
    return `GeeClaw_${info.platform}_${info.arch}`;
}
/**
 * 生成 UUID v4 格式的 ID
 */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
/**
 * 生成指定长度的十六进制 ID
 */
export function generateId(length = 16) {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}
/**
 * 安全 JSON 序列化
 */
export function safeStringify(obj) {
    try {
        return JSON.stringify(obj);
    }
    catch {
        return '{}';
    }
}
