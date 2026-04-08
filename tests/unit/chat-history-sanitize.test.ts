import { describe, expect, it } from 'vitest';
import { prepareHistoryMessagesForDisplay } from '@/stores/chat';

describe('prepareHistoryMessagesForDisplay', () => {
  it('sanitizes user messages before they reach the chat UI', () => {
    const messages = prepareHistoryMessagesForDisplay([
      {
        role: 'user',
        timestamp: 1,
        content:
          'Sender (untrusted metadata):\n```json\n{"name":"alice"}\n```\n\n[WhatsApp 2026-01-24 13:36] hello\n[message_id: abc123]',
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: 'user',
      senderLabel: 'alice',
      content: 'hello',
    });
  });

  it('filters internal system and ack-only assistant history messages', () => {
    const messages = prepareHistoryMessagesForDisplay([
      {
        role: 'user',
        timestamp: 1,
        content: 'hello',
      },
      {
        role: 'system',
        timestamp: 2,
        content: 'Gateway restarted',
      },
      {
        role: 'assistant',
        timestamp: 3,
        content: 'HEARTBEAT_OK',
      },
      {
        role: 'assistant',
        timestamp: 4,
        content: '正常回复',
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.content)).toEqual(['hello', '正常回复']);
  });

  it('preserves normal assistant history messages that only mention ack tokens', () => {
    const messages = prepareHistoryMessagesForDisplay([
      {
        role: 'assistant',
        timestamp: 1,
        content: 'The gateway replied with NO_REPLY earlier, but this is still a real answer.',
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('The gateway replied with NO_REPLY earlier, but this is still a real answer.');
  });

  it('drops assistant history messages that only contain truncated OpenClaw internal context', () => {
    const messages = prepareHistoryMessagesForDisplay([
      {
        role: 'assistant',
        timestamp: 1,
        content: [
          {
            type: 'text',
            text: [
              '<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>',
              'OpenClaw runtime context (internal):',
              'A completed subagent task is ready for user delivery.',
              '...(truncated)...',
            ].join('\n'),
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(0);
  });

  it('keeps media-only assistant history messages so image attachments can be hydrated', () => {
    const messages = prepareHistoryMessagesForDisplay([
      {
        role: 'assistant',
        timestamp: 1,
        content: [
          {
            type: 'text',
            text: 'MEDIA:https://example.com/report.png',
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?._attachedFiles).toEqual([
      expect.objectContaining({
        url: 'https://example.com/report.png',
      }),
    ]);
  });

  it('drops commentary-only assistant history messages', () => {
    const messages = prepareHistoryMessagesForDisplay([
      {
        role: 'assistant',
        timestamp: 1,
        content: [
          {
            type: 'text',
            text: 'thinking like caveman',
            textSignature: JSON.stringify({ v: 1, id: 'msg-commentary', phase: 'commentary' }),
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(0);
  });

  it('keeps unmatched tool_result turns visible instead of merging by tool name alone', () => {
    const messages = prepareHistoryMessagesForDisplay([
      {
        role: 'assistant',
        timestamp: 1,
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'bash',
            arguments: { command: 'pwd' },
          },
        ],
      },
      {
        role: 'toolresult',
        timestamp: 2,
        toolCallId: 'call-2',
        toolName: 'bash',
        content: 'orphan tool result',
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).not.toHaveProperty('_toolStatuses.0.result', 'orphan tool result');
    expect(messages[1]).toMatchObject({
      role: 'toolresult',
      content: 'orphan tool result',
    });
  });

  it('keeps partially matched standalone tool_result messages visible', () => {
    const messages = prepareHistoryMessagesForDisplay([
      {
        role: 'assistant',
        timestamp: 1,
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'bash',
            arguments: { command: 'pwd' },
          },
        ],
      },
      {
        role: 'toolresult',
        timestamp: 2,
        content: [
          {
            type: 'toolResult',
            id: 'call-1',
            name: 'bash',
            text: 'matched result',
            status: 'completed',
          },
          {
            type: 'toolResult',
            id: 'call-2',
            name: 'bash',
            text: 'unmatched result',
            status: 'completed',
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]?._toolStatuses).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        result: 'matched result',
      }),
    ]);
    expect(messages[1]).toMatchObject({ role: 'toolresult' });
    expect(messages[1]).not.toHaveProperty('_toolResultMatched');
  });
});
