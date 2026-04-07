import { describe, expect, it } from 'vitest';
import { formatToolDisplaySummary } from '@/pages/Chat/tool-display';

describe('formatToolDisplaySummary', () => {
  it('formats read offsets like OpenClaw', () => {
    expect(formatToolDisplaySummary('read', { path: '/tmp/a.txt', offset: 10, limit: 20 })).toMatchObject({
      emoji: '📖',
      label: 'read',
      detailLine: '/tmp/a.txt:10-30',
      summaryLine: '📖 read: /tmp/a.txt:10-30',
    });
  });

  it('formats browser action detail lines from configured keys', () => {
    expect(formatToolDisplaySummary('browser', { action: 'open', targetUrl: 'https://example.com' })).toMatchObject({
      emoji: '🌐',
      label: 'browser',
      verb: 'open',
      detail: 'https://example.com',
      detailLine: 'open · https://example.com',
      summaryLine: '🌐 browser: open · https://example.com',
    });
  });

  it('truncates and compacts arrays in detail values', () => {
    expect(formatToolDisplaySummary('browser', {
      action: 'upload',
      paths: ['a', 'b', 'c', 'd'],
    }).detailLine).toBe('upload · a, b, c…');
  });
});
