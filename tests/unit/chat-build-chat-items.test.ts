import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a single live assistant row for runtime content', () => {
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

    expect(items).toHaveLength(2);
    expect(items[0]?.message.id).toBe('history-1');
    expect(items[1]).toMatchObject({
      key: 'stream:agent:main:main:6',
      isStreaming: true,
      message: {
        role: 'assistant',
        id: 'stream:agent:main:main:6',
        timestamp: 6,
      },
    });
  });

  it('uses the latest runtime timestamp when streamingTextStartedAt is missing', () => {
    const toolMessages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'tool-1',
        toolCallId: 'tool-1',
        content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } }],
        timestamp: 1,
      },
      {
        role: 'assistant',
        id: 'tool-2',
        toolCallId: 'tool-2',
        content: [{ type: 'toolCall', id: 'tool-2', name: 'fetch', arguments: { url: 'https://example.com' } }],
        timestamp: 3,
      },
    ];

    const items = buildChatItems({
      messages: [],
      toolMessages,
      streamSegments: [
        { text: '现在我为你查询', ts: 2 },
      ],
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'agent:main:main',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'stream:agent:main:main:3',
      isStreaming: true,
      message: {
        role: 'assistant',
        id: 'stream:agent:main:main:3',
        timestamp: 3,
      },
    });
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

    expect(items).toHaveLength(2);
    expect(items[0]?.message.id).toBe('history-1');
    expect(items[1]).toMatchObject({
      key: 'stream:agent:main:main:4',
      isStreaming: true,
      message: {
        role: 'assistant',
        id: 'stream:agent:main:main:4',
        timestamp: 4,
      },
    });
  });

  it('uses the latest stream segment timestamp when hidden process tool messages are skipped', () => {
    const items = buildChatItems({
      messages: [],
      toolMessages: [
        {
          role: 'assistant',
          id: 'tool-process',
          toolCallId: 'tool-process',
          content: [{ type: 'toolCall', id: 'tool-process', name: 'process', arguments: { action: 'poll' } }],
          timestamp: 1,
        } as RawMessage,
        {
          role: 'assistant',
          id: 'tool-bash',
          toolCallId: 'tool-bash',
          content: [{ type: 'toolCall', id: 'tool-bash', name: 'bash', arguments: { command: 'pwd' } }],
          timestamp: 2,
        } as RawMessage,
      ],
      streamSegments: [
        { text: 'text-1', ts: 10 },
        { text: 'text-2', ts: 20 },
      ],
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'agent:main:main',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'stream:agent:main:main:20',
      isStreaming: true,
      message: {
        role: 'assistant',
        id: 'stream:agent:main:main:20',
        timestamp: 20,
      },
    });
  });

  it('filters process-only standalone toolresult messages backed by toolResult blocks', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'toolresult',
          id: 'toolresult-process',
          content: [
            {
              type: 'toolResult',
              id: 'tool-process',
              name: 'process',
              text: 'polling...',
            },
          ],
          timestamp: 1,
        } as RawMessage,
      ],
      toolMessages: [],
      streamSegments: [],
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'agent:main:main',
    });

    expect(items).toHaveLength(0);
  });

  it('keeps history item keys stable when hidden process messages are removed', () => {
    const items = buildChatItems({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool-process', name: 'process', arguments: { action: 'poll' } }],
          timestamp: 1,
        } as RawMessage,
        {
          role: 'assistant',
          content: 'visible assistant message',
          timestamp: 2,
        } as RawMessage,
      ],
      toolMessages: [],
      streamSegments: [],
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'agent:main:main',
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe('msg:assistant:2:1');
  });

  it('falls back to the current time when runtime content has no timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'));

    const items = buildChatItems({
      messages: [],
      toolMessages: [
        {
          role: 'assistant',
          id: 'tool-bash',
          toolCallId: 'tool-bash',
          content: [{ type: 'toolCall', id: 'tool-bash', name: 'bash', arguments: { command: 'pwd' } }],
        } as RawMessage,
      ],
      streamSegments: [],
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'agent:main:main',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'stream:agent:main:main:1777118400',
      isStreaming: true,
      message: {
        role: 'assistant',
        id: 'stream:agent:main:main:1777118400',
        timestamp: 1777118400,
      },
    });
  });
});
