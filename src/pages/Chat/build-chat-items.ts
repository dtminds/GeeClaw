import type { RawMessage } from '@/stores/chat';
import { shouldHideToolTrace } from './message-utils';

export type ChatRenderItem = {
  key: string;
  message: RawMessage;
  isStreaming: boolean;
};

type BuildChatItemsOptions = {
  messages: RawMessage[];
  toolMessages: RawMessage[];
  streamSegments: Array<{ text: string; ts: number }>;
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

function makeAssistantTextMessage(text: string, timestamp: number, id: string): RawMessage {
  return {
    role: 'assistant',
    id,
    content: text,
    timestamp,
  };
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
    items.push({
      key: streamId,
      message: makeAssistantTextMessage(streamingText, timestamp, streamId),
      isStreaming: true,
    });
  }

  return items;
}
