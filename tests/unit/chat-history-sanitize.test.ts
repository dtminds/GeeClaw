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
});
