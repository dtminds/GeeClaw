import { describe, expect, it } from 'vitest';
import { extractText } from '@/pages/Chat/message-utils';

describe('extractText', () => {
  it('sanitizes unsanitized user history messages at render time', () => {
    const text = extractText({
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'Sender (untrusted metadata):\n```json\n{"name":"alice"}\n```\n\n[WhatsApp 2026-01-24 13:36] hello\n[message_id: abc123]',
        },
      ],
    });

    expect(text).toBe('hello');
  });
});
