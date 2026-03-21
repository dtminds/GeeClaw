import type { RawMessage } from '@/stores/chat';

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

export function buildChatItems({
  messages,
  toolMessages,
  streamSegments,
  streamingText,
  streamingTextStartedAt,
  sessionKey,
}: BuildChatItemsOptions): ChatRenderItem[] {
  const items: ChatRenderItem[] = messages.map((message, index) => ({
    key: messageKey(message, index),
    message,
    isStreaming: false,
  }));

  const maxLen = Math.max(streamSegments.length, toolMessages.length);
  for (let index = 0; index < maxLen; index += 1) {
    const segment = streamSegments[index];
    if (segment && segment.text.trim()) {
      items.push({
        key: `stream-seg:${sessionKey}:${index}`,
        message: makeAssistantTextMessage(segment.text, segment.ts, `stream-seg:${sessionKey}:${index}`),
        isStreaming: false,
      });
    }

    const toolMessage = toolMessages[index];
    if (toolMessage) {
      items.push({
        key: messageKey(toolMessage, messages.length + index),
        message: toolMessage,
        isStreaming: false,
      });
    }
  }

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
