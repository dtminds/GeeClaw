/**
 * core/reporter.ts — 伽利略遥测上报核心服务
 *
 * 从 claw-plugin-report/reporter.ts 迁移并适配 geeclaw-plugin 架构。
 * 采用类实例（非模块级单例），由 geeclaw-plugin index.ts 统一创建和管理。
 *
 * 关键改动（相比原 claw-plugin-report）：
 * 1. 从模块级全局状态 → 类实例状态（支持多实例测试）
 * 2. 去掉 GalileoReport 单例类包装，直接暴露 GeeClawReporter 类
 * 3. 去掉 configDir 配置文件加载（配置收入 configSchema）
 * 4. 新增 createPackageReporter() 工厂方法，为每个 package 创建带 packageId 的代理
 *
 * 上报格式参考伽利略网页上报文档：
 * https://iwiki.woa.com/p/4012224355
 */
import type { ReporterInitOptions, PendingEvent, GeeClawSharedParams, TelemetryReporter } from './reporter-types.js';
/**
 * GeeClawReporter — 伽利略遥测上报核心类
 *
 * 由 geeclaw-plugin index.ts 创建唯一实例，通过 createPackageReporter()
 * 为每个 package 生成带 packageId 的 TelemetryReporter 代理。
 */
export declare class GeeClawReporter {
    private pendingQueue;
    private isFlushing;
    private flushTimer;
    private rateLimitTokensUsed;
    private rateLimitWindowStart;
    private cachedParams;
    private logger;
    private enabled;
    private initialized;
    private initConfig;
    private lastInitOptions;
    private sharedParamsSyncTimer;
    private deviceId;
    private sessionId;
    private openclawVersion;
    /**
     * 初始化上报模块
     */
    init(options: ReporterInitOptions): void;
    /**
     * 上报事件（fire-and-forget）
     */
    reportEvent(name: string, options?: Record<string, unknown>): void;
    /**
     * 异步上报事件（可 await）
     */
    reportEventAsync(name: string, options?: Record<string, unknown>): Promise<void>;
    /**
     * 设置上报公共参数
     */
    setCommonParams(params: Record<string, unknown>): void;
    /**
     * 设置 OpenClaw 版本号
     */
    setOpenclawVersion(version: string): void;
    /**
     * 检查上报模块是否已初始化
     */
    isInitialized(): boolean;
    /**
     * 销毁上报模块
     */
    destroy(): void;
    /**
     * 为指定 package 创建带 packageId 的 TelemetryReporter 代理
     *
     * 每个 package 通过 ctx.reporter 获取的就是这个代理实例。
     * 上报时自动携带 packageId 作为 page_id。
     */
    createPackageReporter(packageId: string): TelemetryReporter;
    /**
     * 从 ~/.geeclaw/geeclaw.json 读取主进程共享的运行时参数
     */
    readSharedParams(): GeeClawSharedParams;
    /**
     * 从共享参数同步到内部缓存
     */
    syncFromSharedParams(forceUpdate?: boolean): boolean;
    /**
     * 启动共享参数定时同步
     */
    private startSharedParamsSync;
    /**
     * 停止共享参数定时同步
     */
    private stopSharedParamsSync;
    /**
     * 构建单条上报数据的 payload（符合伽利略网页上报协议）
     */
    private buildReportPayload;
    /**
     * 通过 HTTP POST 发送单条上报数据
     */
    private sendReport;
    /**
     * 尝试获取一个上报令牌（令牌桶限流）
     */
    private tryAcquireToken;
    /**
     * 计算距离当前限流窗口结束还剩多少毫秒
     */
    private remainingWindowMs;
    /**
     * 刷新待上报队列
     */
    private flushQueue;
    /**
     * 调度队列刷新
     */
    private scheduleFlush;
    /**
     * 尝试从缓存参数自恢复初始化
     */
    private tryAutoRecover;
    /**
     * 获取待上报队列长度（仅用于测试）
     */
    _getPendingQueueLength(): number;
    /**
     * 获取待上报队列内容（仅用于测试）
     */
    _getPendingQueue(): readonly PendingEvent[];
    /**
     * 获取是否已初始化（仅用于测试，不检查 enabled）
     */
    _getInitialized(): boolean;
}
