import { describe, expect, it } from 'vitest';
import { splitMediaFromOutput } from '@/lib/media-output';

describe('splitMediaFromOutput', () => {
  it('extracts MEDIA url directives and strips them from visible text', () => {
    const result = splitMediaFromOutput('Here is the screenshot.\nMEDIA:https://example.com/screenshot.png');

    expect(result).toEqual({
      text: 'Here is the screenshot.',
      mediaUrls: ['https://example.com/screenshot.png'],
      mediaUrl: 'https://example.com/screenshot.png',
    });
  });

  it('keeps MEDIA mentions in prose', () => {
    const input = 'The MEDIA: tag must be on its own line.';
    const result = splitMediaFromOutput(input);

    expect(result.mediaUrls).toBeUndefined();
    expect(result.text).toBe(input);
  });

  it('does not extract MEDIA directives from fenced code blocks', () => {
    const input = [
      '```text',
      'MEDIA:https://example.com/inside-code.png',
      '```',
      'Outside code',
    ].join('\n');
    const result = splitMediaFromOutput(input);

    expect(result.mediaUrls).toBeUndefined();
    expect(result.text).toBe(input);
  });
});
