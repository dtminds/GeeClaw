import type { ContentBlock, RawMessage, ToolStatus, ToolStreamEntry } from './model';
import {
  collectToolUpdates,
  isToolResultRole,
  mergeToolStatus,
  upsertToolStatuses,
} from './tool-status';
import {
  getMessageText,
  stripRenderedPrefixFromStreamingText,
  toMs,
} from './utils';

export function buildToolStreamMessage(entry: ToolStreamEntry): RawMessage {
  const content: ContentBlock[] = [
    {
      type: 'toolCall',
      id: entry.toolCallId,
      name: entry.name,
      arguments: entry.args ?? {},
    },
  ];

  if (entry.output) {
    content.push({
      type: 'toolResult',
      id: entry.toolCallId,
      name: entry.name,
      text: entry.output,
      status: entry.status,
      isError: entry.status === 'error',
    });
  }

  return {
    role: 'assistant',
    id: `live-tool:${entry.toolCallId}`,
    toolCallId: entry.toolCallId,
    toolName: entry.name,
    timestamp: entry.startedAt,
    content,
    _toolStatuses: [
      {
        id: entry.toolCallId,
        toolCallId: entry.toolCallId,
        name: entry.name,
        status: entry.status,
        durationMs: entry.durationMs,
        result: entry.output,
        updatedAt: entry.updatedAt,
        input: entry.args,
      },
    ],
  };
}

export function syncToolMessages(
  toolStreamOrder: string[],
  toolStreamById: Map<string, ToolStreamEntry>,
): RawMessage[] {
  return toolStreamOrder
    .map((id) => toolStreamById.get(id)?.message)
    .filter((message): message is RawMessage => Boolean(message));
}

function collectPersistedToolCallIds(messages: RawMessage[]): Set<string> {
  const persisted = new Set<string>();

  for (const message of messages) {
    if (!message) continue;

    if (isToolResultRole(message.role) && message.toolCallId) {
      persisted.add(message.toolCallId);
    }

    for (const status of message._toolStatuses || []) {
      const toolCallId = status.toolCallId || status.id;
      if (!toolCallId) continue;
      if (status.status !== 'running' || typeof status.result === 'string') {
        persisted.add(toolCallId);
      }
    }
  }

  return persisted;
}

export function reconcileToolRuntimeWithHistory(
  toolStreamOrder: string[],
  toolStreamById: Map<string, ToolStreamEntry>,
  toolResultHistoryReloadedIds: Set<string>,
  messages: RawMessage[],
): {
  toolStreamOrder: string[];
  toolStreamById: Map<string, ToolStreamEntry>;
  toolMessages: RawMessage[];
  toolResultHistoryReloadedIds: Set<string>;
} {
  const persistedToolCallIds = collectPersistedToolCallIds(messages);
  if (persistedToolCallIds.size === 0) {
    return {
      toolStreamOrder,
      toolStreamById,
      toolMessages: syncToolMessages(toolStreamOrder, toolStreamById),
      toolResultHistoryReloadedIds,
    };
  }

  let changed = false;
  const nextToolStreamOrder = toolStreamOrder.filter((toolCallId) => {
    const keep = !persistedToolCallIds.has(toolCallId);
    if (!keep) changed = true;
    return keep;
  });

  if (!changed) {
    return {
      toolStreamOrder,
      toolStreamById,
      toolMessages: syncToolMessages(toolStreamOrder, toolStreamById),
      toolResultHistoryReloadedIds,
    };
  }

  const nextToolStreamById = new Map(toolStreamById);
  const nextReloadedIds = new Set(toolResultHistoryReloadedIds);
  for (const toolCallId of persistedToolCallIds) {
    nextToolStreamById.delete(toolCallId);
    nextReloadedIds.delete(toolCallId);
  }

  return {
    toolStreamOrder: nextToolStreamOrder,
    toolStreamById: nextToolStreamById,
    toolMessages: syncToolMessages(nextToolStreamOrder, nextToolStreamById),
    toolResultHistoryReloadedIds: nextReloadedIds,
  };
}

function collectHistoryToolResultUpdates(message: RawMessage): ToolStatus[] {
  const updates: ToolStatus[] = [];

  if (isToolResultRole(message.role)) {
    for (const update of collectToolUpdates(message, 'final')) {
      if (!update.toolCallId) continue;
      if (update.result === undefined && update.status === 'running') continue;
      updates.push(update);
    }
  }

  for (const status of message._toolStatuses || []) {
    if (!status.toolCallId) continue;
    if (status.result === undefined && status.status === 'running') continue;
    updates.push(status);
  }

  return updates;
}

function collectMessageToolCallIds(message: RawMessage): Set<string> {
  const toolCallIds = new Set<string>();

  for (const update of collectToolUpdates(message, 'delta')) {
    const toolCallId = update.toolCallId || update.id;
    if (toolCallId) {
      toolCallIds.add(toolCallId);
    }
  }

  for (const status of message._toolStatuses || []) {
    const toolCallId = status.toolCallId || status.id;
    if (toolCallId) {
      toolCallIds.add(toolCallId);
    }
  }

  return toolCallIds;
}

export function mergeHistoryToolStatusesIntoMessages(
  currentMessages: RawMessage[],
  historyMessages: RawMessage[],
): RawMessage[] {
  const updatesByToolCallId = new Map<string, ToolStatus[]>();

  for (const historyMessage of historyMessages) {
    for (const update of collectHistoryToolResultUpdates(historyMessage)) {
      if (!update.toolCallId) continue;
      const existing = updatesByToolCallId.get(update.toolCallId) || [];
      existing.push(update);
      updatesByToolCallId.set(update.toolCallId, existing);
    }
  }

  if (updatesByToolCallId.size === 0) {
    return currentMessages;
  }

  return currentMessages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }

    const updates: ToolStatus[] = [];
    for (const toolCallId of collectMessageToolCallIds(message)) {
      const matching = updatesByToolCallId.get(toolCallId);
      if (matching) {
        updates.push(...matching);
      }
    }

    if (updates.length === 0) {
      return message;
    }

    return {
      ...message,
      _toolStatuses: upsertToolStatuses(message._toolStatuses || [], updates),
    };
  });
}

export function collectLiveToolStatuses(toolMessages: RawMessage[]): ToolStatus[] {
  let next: ToolStatus[] = [];

  for (const message of toolMessages) {
    if (!message?._toolStatuses?.length) continue;
    next = upsertToolStatuses(next, message._toolStatuses);
  }

  return next;
}

export function hasRunningLiveToolMessages(toolMessages: RawMessage[]): boolean {
  return toolMessages.some((message) => (
    (message._toolStatuses || []).some((status) => status.status === 'running')
  ));
}

type OrderedLiveAssistantContentItem = {
  sortTimestamp: number;
  sourceIndex: number;
  blocks: ContentBlock[];
};

function normalizeLiveToolMessageContentBlocks(message: RawMessage): ContentBlock[] {
  if (!Array.isArray(message.content)) {
    return [];
  }

  const blocks: ContentBlock[] = [];
  const seenToolCallIds = new Set<string>();

  for (const block of message.content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type !== 'toolCall' && block.type !== 'toolResult' && block.type !== 'tool_use' && block.type !== 'tool_result') {
      continue;
    }

    const normalizedType = block.type === 'tool_use'
      ? 'toolCall'
      : block.type === 'tool_result'
        ? 'toolResult'
        : block.type;
    const identity = `${normalizedType}:${block.id || block.name || ''}`;
    if (seenToolCallIds.has(identity)) {
      continue;
    }
    seenToolCallIds.add(identity);
    blocks.push({
      ...block,
      type: normalizedType,
    });
  }

  return blocks;
}

export function buildOrderedLiveAssistantContentBlocks(
  streamSegments: Array<{ text: string; ts: number }>,
  toolMessages: RawMessage[],
): ContentBlock[] {
  const items: OrderedLiveAssistantContentItem[] = [];

  streamSegments.forEach((segment, index) => {
    if (!segment.text.trim()) {
      return;
    }

    items.push({
      sortTimestamp: segment.ts,
      sourceIndex: index,
      blocks: [{ type: 'text', text: segment.text }],
    });
  });

  toolMessages.forEach((message, index) => {
    const blocks = normalizeLiveToolMessageContentBlocks(message);
    if (blocks.length === 0) {
      return;
    }

    items.push({
      sortTimestamp: typeof message.timestamp === 'number' ? message.timestamp : Number.POSITIVE_INFINITY,
      sourceIndex: streamSegments.length + index,
      blocks,
    });
  });

  items.sort((left, right) => {
    const leftTimestampMs = toMs(left.sortTimestamp);
    const rightTimestampMs = toMs(right.sortTimestamp);
    if (leftTimestampMs !== rightTimestampMs) {
      return leftTimestampMs - rightTimestampMs;
    }

    return left.sourceIndex - right.sourceIndex;
  });

  return items.flatMap((item) => item.blocks);
}

export function normalizeFinalAssistantContentBlocks(
  content: RawMessage['content'],
  streamSegments: Array<{ text: string; ts: number }>,
): ContentBlock[] {
  const normalizeVisibleText = (text: string): string => text.trimStart();

  if (typeof content === 'string') {
    const visibleText = normalizeVisibleText(stripRenderedPrefixFromStreamingText(content, streamSegments));
    return visibleText.trim() ? [{ type: 'text', text: visibleText }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const visibleBlocks = content.filter((block): block is ContentBlock => {
    if (!block || typeof block !== 'object') return false;
    return block.type !== 'toolCall'
      && block.type !== 'toolResult'
      && block.type !== 'tool_use'
      && block.type !== 'tool_result';
  });

  const fullText = getMessageText(visibleBlocks);
  if (!fullText) {
    return visibleBlocks;
  }

  const normalizedFullText = normalizeVisibleText(fullText);
  const visibleText = normalizeVisibleText(stripRenderedPrefixFromStreamingText(fullText, streamSegments));
  let prefixToRemove = normalizedFullText.endsWith(visibleText)
    ? normalizedFullText.slice(0, normalizedFullText.length - visibleText.length)
    : '';
  const normalizedBlocks: ContentBlock[] = [];
  let sawTextBlock = false;
  let emittedVisibleText = false;

  for (const block of visibleBlocks) {
    if (block.type !== 'text') {
      normalizedBlocks.push(block);
      continue;
    }

    let nextText = block.text ?? '';

    if (sawTextBlock && prefixToRemove.startsWith('\n')) {
      prefixToRemove = prefixToRemove.slice(1);
    }
    sawTextBlock = true;

    if (prefixToRemove && nextText) {
      const consumeLength = Math.min(prefixToRemove.length, nextText.length);
      nextText = nextText.slice(consumeLength);
      prefixToRemove = prefixToRemove.slice(consumeLength);
    }

    if (!emittedVisibleText) {
      nextText = normalizeVisibleText(nextText);
    }

    if (!nextText) {
      continue;
    }

    normalizedBlocks.push({
      ...block,
      text: nextText,
    });
    emittedVisibleText = true;
  }

  return normalizedBlocks;
}

export function mergeToolStatusesIntoEquivalentAssistantMessage(
  messages: RawMessage[],
  candidate: RawMessage,
  updates: ToolStatus[],
): RawMessage[] {
  if (updates.length === 0) {
    return messages;
  }

  const candidateId = candidate.id;
  const candidateText = getMessageText(candidate.content).trim();
  const candidateTs = typeof candidate.timestamp === 'number' ? toMs(candidate.timestamp) : null;
  let matched = false;

  return messages.map((message) => {
    if (matched || message.role !== 'assistant') {
      return message;
    }

    const sameId = !!candidateId && message.id === candidateId;
    const sameText = candidateText
      && getMessageText(message.content).trim() === candidateText
      && (
        candidateTs == null
        || typeof message.timestamp !== 'number'
        || Math.abs(toMs(message.timestamp) - candidateTs) < 5000
      );

    if (!sameId && !sameText) {
      return message;
    }

    matched = true;
    return {
      ...message,
      content: candidate.content,
      _toolStatuses: upsertToolStatuses(message._toolStatuses || [], updates),
    };
  });
}

export function patchToolRuntimeWithHistory(
  toolStreamOrder: string[],
  toolStreamById: Map<string, ToolStreamEntry>,
  toolResultHistoryReloadedIds: Set<string>,
  messages: RawMessage[],
  minTimestampMs: number,
): {
  toolStreamOrder: string[];
  toolStreamById: Map<string, ToolStreamEntry>;
  toolMessages: RawMessage[];
  toolResultHistoryReloadedIds: Set<string>;
} {
  const nextToolStreamById = new Map(toolStreamById);
  const nextToolStreamOrder = [...toolStreamOrder];
  const nextReloadedIds = new Set(toolResultHistoryReloadedIds);

  for (const message of messages) {
    const messageTimestampMs = typeof message.timestamp === 'number' ? toMs(message.timestamp) : 0;
    if (minTimestampMs > 0 && messageTimestampMs > 0 && messageTimestampMs < minTimestampMs) {
      continue;
    }

    for (const update of collectHistoryToolResultUpdates(message)) {
      const toolCallId = update.toolCallId;
      if (!toolCallId) continue;

      const existing = nextToolStreamById.get(toolCallId);
      if (!existing) continue;

      const entry: ToolStreamEntry = {
        ...existing,
        name: update.name || existing.name,
        output: update.result ?? existing.output,
        status: mergeToolStatus(existing.status, update.status),
        durationMs: update.durationMs ?? existing.durationMs,
        updatedAt: update.updatedAt || Date.now(),
      };
      entry.message = buildToolStreamMessage(entry);
      nextToolStreamById.set(toolCallId, entry);
      nextReloadedIds.add(toolCallId);
    }
  }

  return {
    toolStreamOrder: nextToolStreamOrder,
    toolStreamById: nextToolStreamById,
    toolMessages: syncToolMessages(nextToolStreamOrder, nextToolStreamById),
    toolResultHistoryReloadedIds: nextReloadedIds,
  };
}
