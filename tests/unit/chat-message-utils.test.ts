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

  it('strips assistant MEDIA control lines from visible text', () => {
    const text = extractText({
      role: 'assistant',
      content: 'Here is the screenshot.\nMEDIA:https://example.com/screenshot.png',
    });

    expect(text).toBe('Here is the screenshot.');
  });

  it('keeps MEDIA mentions in assistant prose when they are not standalone directives', () => {
    const text = extractText({
      role: 'assistant',
      content: 'The MEDIA: tag must be on its own line.',
    });

    expect(text).toBe('The MEDIA: tag must be on its own line.');
  });

  it('strips gateway timestamps and media attachment markers from user text after classification', () => {
    const text = extractText({
      role: 'user',
      content: '[Fri 2026-03-13 17:11 GMT+8] hello\n[media attached:/tmp/demo.png (image/png) | /tmp/demo.png]',
    });

    expect(text).toBe('hello');
  });
});
