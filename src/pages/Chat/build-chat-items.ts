import type { ContentBlock, RawMessage, ToolStatus } from '@/stores/chat';
import type { AssistantMessageWithLiveRuntime, LiveAssistantStreamSegment } from './assistant-display';
import { shouldHideToolTrace } from './message-utils';

export type ChatRenderItem = {
  key: string;
  message: RawMessage;
  isStreaming: boolean;
};

type BuildChatItemsOptions = {
  messages: RawMessage[];
  toolMessages: RawMessage[];
  streamSegments: LiveAssistantStreamSegment[];
  streamingText: string;
  streamingTextStartedAt: number | null;
  sessionKey: string;
};

function messageKey(message: RawMessage, index: number): string {
  if (message.id) return `msg:${message.id}`;
  if (message.toolCallId) return `tool:${message.toolCallId}`;
  if (typeof message.timestamp === 'number') {
    return `msg:${message.role}:${message.timestamp}:${index}`;
  }
  return `msg:${message.role}:${index}`;
}

function isHiddenToolOnlyMessage(message: RawMessage): boolean {
  const role = (message.role || '').toLowerCase();
  if ((role === 'toolresult' || role === 'tool_result') && shouldHideToolTrace(message.toolName)) {
    return true;
  }

  if (!Array.isArray(message.content)) {
    return false;
  }

  let sawHiddenToolBlock = false;
  for (const block of message.content) {
    if (!block || typeof block !== 'object') {
      return false;
    }

    if (
      (block.type === 'tool_use'
        || block.type === 'toolCall'
        || block.type === 'tool_result'
        || block.type === 'toolResult')
      && shouldHideToolTrace(block.name)
    ) {
      sawHiddenToolBlock = true;
      continue;
    }

    return false;
  }

  return sawHiddenToolBlock;
}

function makeAssistantLiveMessage(
  content: RawMessage['content'],
  timestamp: number,
  id: string,
  toolStatuses: ToolStatus[],
  liveToolMessages: RawMessage[],
  liveStreamSegments: LiveAssistantStreamSegment[],
): AssistantMessageWithLiveRuntime {
  return {
    role: 'assistant',
    id,
    content,
    timestamp,
    _toolStatuses: toolStatuses.length > 0 ? toolStatuses : undefined,
    _liveToolMessages: liveToolMessages,
    _liveStreamSegments: liveStreamSegments,
  };
}

function normalizeLiveToolMessageContentBlocks(message: RawMessage): ContentBlock[] {
  if (!Array.isArray(message.content) || isHiddenToolOnlyMessage(message)) {
    return [];
  }

  const blocks: ContentBlock[] = [];
  const seenBlockKeys = new Set<string>();

  for (const block of message.content) {
    if (!block || typeof block !== 'object') {
      continue;
    }

    if (
      block.type !== 'tool_use'
      && block.type !== 'tool_result'
      && block.type !== 'toolCall'
      && block.type !== 'toolResult'
    ) {
      continue;
    }

    const normalizedType = block.type === 'tool_use'
      ? 'toolCall'
      : block.type === 'tool_result'
        ? 'toolResult'
        : block.type;
    const blockKey = `${normalizedType}:${block.id || block.name || ''}`;
    if (seenBlockKeys.has(blockKey)) {
      continue;
    }

    seenBlockKeys.add(blockKey);
    blocks.push({
      ...block,
      type: normalizedType,
    });
  }

  return blocks;
}

function buildLiveAssistantContent(
  toolMessages: RawMessage[],
  streamSegments: LiveAssistantStreamSegment[],
  streamingText: string,
): ContentBlock[] {
  const items: Array<{ sortTimestamp: number; sourceIndex: number; blocks: ContentBlock[] }> = [];

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
    if (left.sortTimestamp !== right.sortTimestamp) {
      return left.sortTimestamp - right.sortTimestamp;
    }

    return left.sourceIndex - right.sourceIndex;
  });

  const blocks = items.flatMap((item) => item.blocks);
  if (streamingText.trim()) {
    blocks.push({ type: 'text', text: streamingText });
  }

  return blocks;
}

function buildLiveAssistantStreamSegments(
  streamSegments: LiveAssistantStreamSegment[],
  streamingText: string,
  trailingTimestamp: number,
): LiveAssistantStreamSegment[] {
  if (!streamingText.trim()) {
    return streamSegments;
  }

  return [
    ...streamSegments,
    {
      text: streamingText,
      ts: trailingTimestamp,
    },
  ];
}

function collectLiveToolStatuses(toolMessages: RawMessage[]): ToolStatus[] {
  const statusesById = new Map<string, ToolStatus>();

  for (const message of toolMessages) {
    if (isHiddenToolOnlyMessage(message) || !message._toolStatuses?.length) {
      continue;
    }

    for (const status of message._toolStatuses) {
      const statusKey = status.toolCallId || status.id || status.name;
      statusesById.set(statusKey, status);
    }
  }

  return [...statusesById.values()];
}

function hasVisibleRuntimeContent(
  toolMessages: RawMessage[],
  streamSegments: Array<{ text: string; ts: number }>,
): boolean {
  if (streamSegments.some((segment) => segment.text.trim())) {
    return true;
  }

  return toolMessages.some((toolMessage) => !isHiddenToolOnlyMessage(toolMessage));
}

function getLiveAssistantTimestamp(
  streamingTextStartedAt: number | null,
  toolMessages: RawMessage[],
  streamSegments: Array<{ text: string; ts: number }>,
): number {
  if (typeof streamingTextStartedAt === 'number') {
    return streamingTextStartedAt;
  }

  let latestRuntimeTimestamp: number | null = null;

  for (const toolMessage of toolMessages) {
    if (isHiddenToolOnlyMessage(toolMessage) || typeof toolMessage.timestamp !== 'number') {
      continue;
    }

    latestRuntimeTimestamp = latestRuntimeTimestamp === null
      ? toolMessage.timestamp
      : Math.max(latestRuntimeTimestamp, toolMessage.timestamp);
  }

  for (const segment of streamSegments) {
    if (!segment.text.trim()) {
      continue;
    }

    latestRuntimeTimestamp = latestRuntimeTimestamp === null
      ? segment.ts
      : Math.max(latestRuntimeTimestamp, segment.ts);
  }

  return latestRuntimeTimestamp ?? Date.now() / 1000;
}

export function buildChatItems({
  messages,
  toolMessages,
  streamSegments,
  streamingText,
  streamingTextStartedAt,
  sessionKey,
}: BuildChatItemsOptions): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  messages.forEach((message, index) => {
    if (isHiddenToolOnlyMessage(message)) {
      return;
    }

    items.push({
      key: messageKey(message, index),
      message,
      isStreaming: false,
    });
  });

  if (streamingText.trim() || hasVisibleRuntimeContent(toolMessages, streamSegments)) {
    const timestamp = getLiveAssistantTimestamp(streamingTextStartedAt, toolMessages, streamSegments);
    const streamId = `stream:${sessionKey}:${timestamp}`;
    const liveContent = buildLiveAssistantContent(toolMessages, streamSegments, streamingText);
    const liveStreamSegments = buildLiveAssistantStreamSegments(streamSegments, streamingText, timestamp + 0.001);
    const liveToolStatuses = collectLiveToolStatuses(toolMessages);
    items.push({
      key: streamId,
      message: makeAssistantLiveMessage(
        liveContent,
        timestamp,
        streamId,
        liveToolStatuses,
        toolMessages,
        liveStreamSegments,
      ),
      isStreaming: true,
    });
  }

  return items;
}
