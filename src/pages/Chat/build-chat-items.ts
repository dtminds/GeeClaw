import type { RawMessage } from '@/stores/chat';
import { shouldHideToolTrace } from './message-utils';

export type ChatRenderItem = {
  key: string;
  message: RawMessage;
  isStreaming: boolean;
};

type RuntimeRenderItem = ChatRenderItem & {
  sortTimestamp: number;
  sourceIndex: number;
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

function buildRuntimeRenderItems(
  toolMessages: RawMessage[],
  streamSegments: Array<{ text: string; ts: number }>,
  sessionKey: string,
  historyCount: number,
): RuntimeRenderItem[] {
  const runtimeItems: RuntimeRenderItem[] = [];

  streamSegments.forEach((segment, index) => {
    if (!segment.text.trim()) {
      return;
    }

    runtimeItems.push({
      key: `stream-seg:${sessionKey}:${index}`,
      message: makeAssistantTextMessage(segment.text, segment.ts, `stream-seg:${sessionKey}:${index}`),
      isStreaming: false,
      sortTimestamp: segment.ts,
      sourceIndex: index,
    });
  });

  toolMessages.forEach((toolMessage, index) => {
    if (isHiddenToolOnlyMessage(toolMessage)) {
      return;
    }

    runtimeItems.push({
      key: messageKey(toolMessage, historyCount + index),
      message: toolMessage,
      isStreaming: false,
      sortTimestamp: typeof toolMessage.timestamp === 'number' ? toolMessage.timestamp : Number.POSITIVE_INFINITY,
      sourceIndex: streamSegments.length + index,
    });
  });

  runtimeItems.sort((left, right) => {
    if (left.sortTimestamp !== right.sortTimestamp) {
      return left.sortTimestamp - right.sortTimestamp;
    }
    return left.sourceIndex - right.sourceIndex;
  });

  return runtimeItems;
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

  items.push(...buildRuntimeRenderItems(toolMessages, streamSegments, sessionKey, messages.length));

  if (streamingText.trim()) {
    const timestamp = streamingTextStartedAt ?? Date.now() / 1000;
    items.push({
      key: `stream:${sessionKey}:${timestamp}`,
      message: makeAssistantTextMessage(streamingText, timestamp, `stream:${sessionKey}:${timestamp}`),
      isStreaming: true,
    });
  }

  return items;
}
