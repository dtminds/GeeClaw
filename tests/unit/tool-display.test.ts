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

  it('formats process and session tool actions with friendly Chinese verbs', () => {
    expect(formatToolDisplaySummary('process', { action: 'poll' }, undefined, true)).toMatchObject({
      verb: '查看进程状态',
      detailLine: '查看进程状态',
      summaryLine: '🧩 process: 查看进程状态',
    });

    expect(formatToolDisplaySummary('process', { action: 'log' }, undefined, true)).toMatchObject({
      verb: '查看进程日志',
      detailLine: '查看进程日志',
      summaryLine: '🧩 process: 查看进程日志',
    });

    expect(formatToolDisplaySummary('sessions_spawn', { task: '整理日志' }, undefined, true)).toMatchObject({
      verb: '启动子任务',
      detail: '整理日志',
      detailLine: '启动子任务 · 整理日志',
      summaryLine: '🧩 sessions_spawn: 启动子任务 · 整理日志',
    });

    expect(formatToolDisplaySummary('sessions_yield', {}, undefined, true)).toMatchObject({
      verb: '等待子任务结果',
      detailLine: '等待子任务结果',
      summaryLine: '🧩 sessions_yield: 等待子任务结果',
    });
  });

  it('keeps process and session tool actions in English when Chinese labels are not preferred', () => {
    expect(formatToolDisplaySummary('process', { action: 'poll' })).toMatchObject({
      verb: 'poll',
      detailLine: 'poll',
      summaryLine: '🧩 process: poll',
    });

    expect(formatToolDisplaySummary('sessions_spawn', { task: 'analyze logs' })).toMatchObject({
      verb: 'spawn',
      detail: 'analyze logs',
      detailLine: 'spawn · analyze logs',
      summaryLine: '🧩 sessions_spawn: spawn · analyze logs',
    });

    expect(formatToolDisplaySummary('sessions_yield', {})).toMatchObject({
      verb: 'yield',
      detailLine: 'yield',
      summaryLine: '🧩 sessions_yield: yield',
    });
  });
});
