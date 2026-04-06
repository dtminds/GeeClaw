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

  it('preserves markdown paragraph breaks when removing MEDIA directive lines', () => {
    const input = [
      'First paragraph.',
      '',
      'MEDIA:https://example.com/screenshot.png',
      '',
      'Second paragraph.',
    ].join('\n');

    const result = splitMediaFromOutput(input);

    expect(result).toEqual({
      text: 'First paragraph.\n\nSecond paragraph.',
      mediaUrls: ['https://example.com/screenshot.png'],
      mediaUrl: 'https://example.com/screenshot.png',
    });
  });

  it('preserves markdown formatting when removing the audio-as-voice tag', () => {
    const input = [
      'Summary paragraph.',
      '',
      '[[audio_as_voice]]',
      '',
      '- first item',
      '  - nested item',
      '',
      'Final paragraph.',
    ].join('\n');

    const result = splitMediaFromOutput(input);

    expect(result).toEqual({
      text: 'Summary paragraph.\n\n- first item\n  - nested item\n\nFinal paragraph.',
      audioAsVoice: true,
    });
  });
});
