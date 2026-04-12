import { describe, expect, it } from 'vitest';
import { buildChatItems } from '@/pages/Chat/build-chat-items';
import type { RawMessage } from '@/stores/chat';

function assistantMessage(id: string, content: unknown, timestamp: number): RawMessage {
  return {
    role: 'assistant',
    id,
    content,
    timestamp,
  };
}

describe('buildChatItems', () => {
  it('interleaves stream segments and tool messages in order', () => {
    const history: RawMessage[] = [
      assistantMessage('history-1', 'history', 1),
    ];
    const toolMessages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'tool-1',
        toolCallId: 'tool-1',
        content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } }],
        timestamp: 3,
      },
      {
        role: 'assistant',
        id: 'tool-2',
        toolCallId: 'tool-2',
        content: [{ type: 'toolCall', id: 'tool-2', name: 'fetch', arguments: { url: 'https://example.com' } }],
        timestamp: 5,
      },
    ];
    const items = buildChatItems({
      messages: history,
      toolMessages,
      streamSegments: [
        { text: 'text-1', ts: 2 },
        { text: 'text-2', ts: 4 },
      ],
      streamingText: 'final-live',
      streamingTextStartedAt: 6,
      sessionKey: 'agent:main:main',
    });

    expect(items.map((item) => item.message.id)).toEqual([
      'history-1',
      'stream-seg:agent:main:main:0',
      'tool-1',
      'stream-seg:agent:main:main:1',
      'tool-2',
      'stream:agent:main:main:6',
    ]);
    expect(items.at(-1)?.isStreaming).toBe(true);
  });

  it('filters process-only history and tool messages before rendering', () => {
    const items = buildChatItems({
      messages: [
        assistantMessage('history-1', 'history', 1),
        {
          role: 'assistant',
          id: 'history-process',
          content: [{ type: 'toolCall', id: 'history-process', name: 'process', arguments: { action: 'poll' } }],
          timestamp: 2,
        } as RawMessage,
      ],
      toolMessages: [
        {
          role: 'assistant',
          id: 'tool-process',
          toolCallId: 'tool-process',
          content: [{ type: 'toolCall', id: 'tool-process', name: 'process', arguments: { action: 'log' } }],
          timestamp: 3,
        } as RawMessage,
        {
          role: 'assistant',
          id: 'tool-bash',
          toolCallId: 'tool-bash',
          content: [{ type: 'toolCall', id: 'tool-bash', name: 'bash', arguments: { command: 'pwd' } }],
          timestamp: 4,
        } as RawMessage,
      ],
      streamSegments: [],
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'agent:main:main',
    });

    expect(items.map((item) => item.message.id)).toEqual([
      'history-1',
      'tool-bash',
    ]);
  });
});
