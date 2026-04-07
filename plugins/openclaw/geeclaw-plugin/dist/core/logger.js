/**
 * core/logger.ts — 统一日志
 *
 * 自动为每个 package 的日志添加 [geeclaw-plugin:<packageId>] 前缀。
 * 底层使用 console.log/warn/error/debug。
 */
/**
 * 创建带前缀的 Logger 实例
 * @param packageId package 的唯一标识
 * @returns GeeClawLogger 实例
 */
export function createLogger(packageId) {
    const prefix = `[geeclaw-plugin:${packageId}]`;
    return {
        info(message, ...args) {
            console.log(`${prefix} ${message}`, ...args);
        },
        warn(message, ...args) {
            console.warn(`${prefix} ${message}`, ...args);
        },
        error(message, ...args) {
            console.error(`${prefix} ${message}`, ...args);
        },
        debug(message, ...args) {
            console.debug(`${prefix} ${message}`, ...args);
        },
    };
}
