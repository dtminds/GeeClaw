import type { RawMessage } from '@/stores/chat';

export interface MessageUsageBreakdown {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costTotal?: number;
}

export interface ContextOccupancyInfo {
  lastRoundTotalTokens: number;
  cacheTokens: number;
  contextLimitTokens?: number;
  ratio: number;
  percent: number;
}

const DEFAULT_USAGE_LOOKBACK_LIMIT = 40;

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function getMessageUsage(message: RawMessage | null | undefined): MessageUsageBreakdown | null {
  const usage = message?.usage;
  if (!usage) return null;

  const inputTokens = typeof usage.input === 'number'
    ? usage.input
    : (typeof usage.promptTokens === 'number' ? usage.promptTokens : undefined);
  const outputTokens = typeof usage.output === 'number'
    ? usage.output
    : (typeof usage.completionTokens === 'number' ? usage.completionTokens : undefined);
  const cacheReadTokens = typeof usage.cacheRead === 'number' ? usage.cacheRead : undefined;
  const cacheWriteTokens = typeof usage.cacheWrite === 'number' ? usage.cacheWrite : undefined;
  const totalTokens = typeof usage.total === 'number'
    ? usage.total
    : (typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined);
  const costTotal = typeof usage.cost?.total === 'number' ? usage.cost.total : undefined;

  const hasAnyValue = [
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    costTotal,
  ].some((value) => value !== undefined);

  if (!hasAnyValue) return null;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    costTotal,
  };
}

export function getContextOccupancyInfo(
  message: RawMessage | null | undefined,
  contextLimitTokens: number | undefined,
): ContextOccupancyInfo {
  const usage = getMessageUsage(message);
  const lastRoundTotalTokens = usage?.totalTokens ?? 0;
  const cacheTokens = (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0);
  const hasValidContextLimit = typeof contextLimitTokens === 'number'
    && Number.isFinite(contextLimitTokens)
    && contextLimitTokens > 0;
  const ratio = hasValidContextLimit && lastRoundTotalTokens > 0
    ? lastRoundTotalTokens / contextLimitTokens
    : 0;
  const percent = Math.max(0, Math.min(100, ratio * 100));

  return {
    lastRoundTotalTokens,
    cacheTokens,
    contextLimitTokens: hasValidContextLimit ? contextLimitTokens : undefined,
    ratio,
    percent,
  };
}

export function findRecentAssistantMessageWithReliableUsage(
  messages: RawMessage[],
  maxLookback = DEFAULT_USAGE_LOOKBACK_LIMIT,
): RawMessage | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const boundedLookback = Number.isFinite(maxLookback)
    ? Math.max(1, Math.floor(maxLookback))
    : DEFAULT_USAGE_LOOKBACK_LIMIT;
  let inspected = 0;

  for (let index = messages.length - 1; index >= 0 && inspected < boundedLookback; index -= 1, inspected += 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    const usage = getMessageUsage(message);
    if (!usage) {
      continue;
    }

    if (typeof usage.totalTokens === 'number' && usage.totalTokens > 0) {
      return message;
    }
  }

  return null;
}
