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
});
