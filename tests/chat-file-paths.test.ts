import { describe, expect, it, vi } from 'vitest';
const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

import {
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  extractRawFilePaths,
  hydrateHistoryMessagesForDisplay,
  limitAttachedFilesForMessage,
  loadMissingPreviews,
  prepareHistoryMessagesForDisplay,
  type RawMessage,
} from '@/stores/chat';

describe('chat file path extraction', () => {
  it('still extracts absolute file paths from prose', () => {
    const refs = extractRawFilePaths('Example image path: /path/to/slide-01.jpg');
    expect(refs.map((ref) => ref.filePath)).toEqual(['/path/to/slide-01.jpg']);
  });

  it('extracts MEDIA-prefixed file paths from tool output', () => {
    const refs = extractRawFilePaths('Saved browser screenshot to MEDIA:/path/to/slide-01.jpg');
    expect(refs).toEqual([{
      filePath: '/path/to/slide-01.jpg',
      mimeType: 'image/jpeg',
    }]);
  });

  it('does not turn exec find output into attachments', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-find',
          name: 'exec',
          input: { command: 'find /tmp -name "*.png"' },
        }],
      },
      {
        role: 'toolresult',
        toolCallId: 'tool-find',
        toolName: 'exec',
        content: '/tmp/exports/a.png\n/tmp/exports/b.png',
      },
      {
        role: 'assistant',
        content: 'I found two images.',
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);

    expect(enriched[2]?._attachedFiles).toBeUndefined();
  });

  it('keeps raw-path attachments for non-scan exec outputs', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-export',
          name: 'exec',
          input: { command: 'python scripts/export_report.py' },
        }],
      },
      {
        role: 'toolresult',
        toolCallId: 'tool-export',
        toolName: 'exec',
        content: 'Saved report to /tmp/exports/report.pdf',
      },
      {
        role: 'assistant',
        content: 'Done.',
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);

    expect(enriched[2]?._attachedFiles).toEqual([{
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      fileSize: 0,
      preview: null,
      filePath: '/tmp/exports/report.pdf',
    }]);
  });

  it('resolves relative tool output artifacts against the agent workspace', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-write',
          name: 'exec',
          input: { command: 'node scripts/write-html.mjs' },
        }],
      },
      {
        role: 'toolresult',
        toolCallId: 'tool-write',
        toolName: 'exec',
        content: 'Successfully wrote 9076 bytes to ./deliverables/presentation-master/2026-04-24-openclaw-intro/index.html',
      },
      {
        role: 'assistant',
        content: 'Done.',
      },
    ];

    const enriched = enrichWithToolResultFiles(messages, { artifactBaseDir: '/Users/demo/geeclaw/workspace' });

    expect(enriched[2]?._attachedFiles).toEqual([{
      fileName: 'index.html',
      mimeType: 'text/html',
      fileSize: 0,
      preview: null,
      filePath: '/Users/demo/geeclaw/workspace/deliverables/presentation-master/2026-04-24-openclaw-intro/index.html',
    }]);
  });

  it('uses write tool input path for relative artifacts without a dot prefix', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-write-readme',
          name: 'write_file',
          input: { path: 'README.md', content: '# Hello' },
        }],
      },
      {
        role: 'toolresult',
        toolCallId: 'tool-write-readme',
        toolName: 'write_file',
        content: 'Successfully wrote 7 bytes',
      },
      {
        role: 'assistant',
        content: 'Done.',
      },
    ];

    const enriched = enrichWithToolResultFiles(messages, { artifactBaseDir: '/Users/demo/geeclaw/workspace' });

    expect(enriched[2]?._attachedFiles).toEqual([{
      fileName: 'README.md',
      mimeType: 'text/markdown',
      fileSize: 0,
      preview: null,
      filePath: '/Users/demo/geeclaw/workspace/README.md',
    }]);
  });

  it('does not guess relative tool output artifacts without an agent workspace', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-write',
          name: 'exec',
          input: { command: 'node scripts/write-html.mjs' },
        }],
      },
      {
        role: 'toolresult',
        toolCallId: 'tool-write',
        toolName: 'exec',
        content: 'Successfully wrote 9076 bytes to ./deliverables/presentation-master/2026-04-24-openclaw-intro/index.html',
      },
      {
        role: 'assistant',
        content: 'Done.',
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);

    expect(enriched[2]?._attachedFiles).toBeUndefined();
  });

  it('does not treat read-file tool output paths as produced artifacts', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-read-memory',
          name: 'read_file',
          input: { path: '/tmp/MEMORY/2026-04-24.md' },
        }],
      },
      {
        role: 'toolresult',
        toolCallId: 'tool-read-memory',
        toolName: 'read_file',
        content: 'Read /tmp/MEMORY/2026-04-24.md',
      },
      {
        role: 'assistant',
        content: '我已读取上下文。',
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);

    expect(enriched[2]?._attachedFiles).toBeUndefined();
  });

  it('keeps edited reserved files as produced artifacts', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-edit-memory',
          name: 'edit_file',
          input: { path: '/tmp/memory.md' },
        }],
      },
      {
        role: 'toolresult',
        toolCallId: 'tool-edit-memory',
        toolName: 'edit_file',
        content: 'Updated /tmp/memory.md',
      },
      {
        role: 'assistant',
        content: '已更新记忆。',
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);

    expect(enriched[2]?._attachedFiles).toEqual([{
      fileName: 'memory.md',
      mimeType: 'text/markdown',
      fileSize: 0,
      preview: null,
      filePath: '/tmp/memory.md',
    }]);
  });

  it('keeps MEDIA-prefixed tool output attachments for non-scan tools', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-browser',
          name: 'browser',
          input: { action: 'screenshot' },
        }],
      },
      {
        role: 'toolresult',
        toolCallId: 'tool-browser',
        toolName: 'browser',
        content: 'Saved screenshot to MEDIA:/Users/lsave/.openclaw-geeclaw/media/browser/68e838f0-cc70-42ea-b567-062d4aa9e397.jpg',
      },
      {
        role: 'assistant',
        content: 'Done.',
      },
    ];

    const enriched = enrichWithToolResultFiles(messages);

    expect(enriched[2]?._attachedFiles).toEqual([{
      fileName: '68e838f0-cc70-42ea-b567-062d4aa9e397.jpg',
      mimeType: 'image/jpeg',
      fileSize: 0,
      preview: null,
      filePath: '/Users/lsave/.openclaw-geeclaw/media/browser/68e838f0-cc70-42ea-b567-062d4aa9e397.jpg',
    }]);
  });

  it('keeps MEDIA url attachments from assistant history messages', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: 'Here is the screenshot.\nMEDIA:https://example.com/screenshot.png',
      },
    ];

    const prepared = prepareHistoryMessagesForDisplay(messages);

    expect(prepared[0]?._attachedFiles).toEqual([
      expect.objectContaining({
        fileName: 'screenshot.png',
        mimeType: 'image/png',
        fileSize: 0,
        preview: 'https://example.com/screenshot.png',
      }),
    ]);
  });

  it('filters attached files whose paths do not exist', async () => {
    hostApiFetchMock.mockResolvedValue({
      '/path/to/slide-01.jpg': { exists: false, preview: null, fileSize: 0 },
    });

    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: 'Example image path: /path/to/slide-01.jpg',
        _attachedFiles: [{
          fileName: 'slide-01.jpg',
          mimeType: 'image/jpeg',
          fileSize: 0,
          preview: null,
          filePath: '/path/to/slide-01.jpg',
        }],
      },
    ];

    const updated = await loadMissingPreviews(messages);

    expect(updated).toBe(true);
    expect(messages[0]?._attachedFiles).toEqual([]);
  });

  it('filters markdown-linked assistant artifacts whose paths do not exist during hydration', async () => {
    hostApiFetchMock.mockResolvedValue({
      '/tmp/reports/missing.xlsx': { exists: false, preview: null, fileSize: 0 },
    });

    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: '已生成 [报销明细](/tmp/reports/missing.xlsx)。',
      },
    ];

    const hydrated = await hydrateHistoryMessagesForDisplay(messages);

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/files/thumbnails', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        paths: [{
          filePath: '/tmp/reports/missing.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }],
      }),
    }));
    expect(hydrated[0]?._attachedFiles).toEqual([]);
  });

  it('revalidates cached existing local artifacts so deleted files are removed', async () => {
    hostApiFetchMock.mockResolvedValue({
      '/tmp/reports/deleted.xlsx': { exists: false, preview: null, fileSize: 0 },
    });

    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: '已生成 [报销明细](/tmp/reports/deleted.xlsx)。',
        _attachedFiles: [{
          fileName: 'deleted.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: 123,
          preview: null,
          filePath: '/tmp/reports/deleted.xlsx',
          exists: true,
        }],
      },
    ];

    const updated = await loadMissingPreviews(messages);

    expect(updated).toBe(true);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/files/thumbnails', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        paths: [{
          filePath: '/tmp/reports/deleted.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }],
      }),
    }));
    expect(messages[0]?._attachedFiles).toEqual([]);
  });

  it('revalidates cached image artifacts without regenerating existing previews', async () => {
    hostApiFetchMock.mockResolvedValue({
      '/tmp/reports/chart.png': { exists: true, preview: null, fileSize: 456 },
    });

    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: '已生成图表。',
        _attachedFiles: [{
          fileName: 'chart.png',
          mimeType: 'image/png',
          fileSize: 456,
          preview: 'data:image/png;base64,cached',
          filePath: '/tmp/reports/chart.png',
          exists: true,
        }],
      },
    ];

    const updated = await loadMissingPreviews(messages);

    expect(updated).toBe(true);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/files/thumbnails', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        paths: [{
          filePath: '/tmp/reports/chart.png',
          mimeType: 'image/png',
          preview: false,
        }],
      }),
    }));
    expect(messages[0]?._attachedFiles?.[0]).toEqual(expect.objectContaining({
      exists: true,
      preview: 'data:image/png;base64,cached',
      fileSize: 456,
    }));
  });

  it('keeps attached files whose paths exist', async () => {
    hostApiFetchMock.mockResolvedValue({
      '/tmp/exports/slide-01.jpg': {
        exists: true,
        preview: 'data:image/jpeg;base64,abc',
        fileSize: 123,
      },
    });

    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: 'Saved to /tmp/exports/slide-01.jpg',
        _attachedFiles: [{
          fileName: 'slide-01.jpg',
          mimeType: 'image/jpeg',
          fileSize: 0,
          preview: null,
          filePath: '/tmp/exports/slide-01.jpg',
        }],
      },
    ];

    const updated = await loadMissingPreviews(messages);

    expect(updated).toBe(true);
    expect(messages[0]?._attachedFiles).toEqual([{
      fileName: 'slide-01.jpg',
      mimeType: 'image/jpeg',
      fileSize: 123,
      preview: 'data:image/jpeg;base64,abc',
      filePath: '/tmp/exports/slide-01.jpg',
      exists: true,
    }]);
  });

  it('caps displayed attachments per message at twenty and records hidden count', () => {
    const files = Array.from({ length: 60 }, (_, index) => ({
      fileName: `file-${index}.txt`,
      mimeType: 'text/plain',
      fileSize: index,
      preview: null,
      filePath: `/tmp/file-${index}.txt`,
    }));

    const limited = limitAttachedFilesForMessage(files);

    expect(limited.files).toHaveLength(20);
    expect(limited.hiddenCount).toBe(40);
    expect(limited.files[0]?.fileName).toBe('file-0.txt');
    expect(limited.files[19]?.fileName).toBe('file-19.txt');
  });

  it('does not create file cards from skill marker paths in the previous user message', () => {
    const messages: RawMessage[] = [
      {
        role: 'user',
        content: '[[use skill: find-skills (/Users/lsave/.openclaw-geeclaw/skills/find-skills/SKILL.md)]]',
      },
      {
        role: 'assistant',
        content: '我已经读取完毕。',
      },
    ];

    const enriched = enrichWithCachedImages(messages);

    expect(enriched[1]?._attachedFiles).toBeUndefined();
  });

  it('does not create assistant artifacts from raw paths in the previous user message', () => {
    const messages: RawMessage[] = [
      {
        role: 'user',
        content: '请读取 /tmp/MEMORY/2026-04-24.md',
      },
      {
        role: 'assistant',
        content: '我已经读取完毕。',
      },
    ];

    const enriched = enrichWithCachedImages(messages);

    expect(enriched[1]?._attachedFiles).toBeUndefined();
  });

  it('extracts local markdown file links from assistant text as artifacts', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: '已生成 [报销明细](/tmp/reports/expense.xlsx)，参考 [官网](https://example.com/report)。',
      },
    ];

    const enriched = enrichWithCachedImages(messages);

    expect(enriched[0]?._attachedFiles).toEqual([{
      fileName: 'expense.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 0,
      preview: null,
      filePath: '/tmp/reports/expense.xlsx',
    }]);
  });

  it('resolves relative markdown file links against the agent workspace', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: '已生成 [报销明细](reports/expense.xlsx)。',
      },
    ];

    const enriched = enrichWithCachedImages(messages, { artifactBaseDir: '/Users/demo/geeclaw/workspace' });

    expect(enriched[0]?._attachedFiles).toEqual([{
      fileName: 'expense.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 0,
      preview: null,
      filePath: '/Users/demo/geeclaw/workspace/reports/expense.xlsx',
    }]);
  });

  it('only builds assistant artifacts for the most recent history messages by default', async () => {
    hostApiFetchMock.mockResolvedValue({
      '/tmp/reports/recent.xlsx': { exists: true, preview: null, fileSize: 123 },
    });

    const messages: RawMessage[] = Array.from({ length: 101 }, (_, index) => ({
      role: 'assistant',
      content: index === 0
        ? '早期产物 [旧报表](/tmp/reports/old.xlsx)。'
        : index === 100
          ? '近期产物 [新报表](/tmp/reports/recent.xlsx)。'
          : `普通消息 ${index}`,
    }));

    const hydrated = await hydrateHistoryMessagesForDisplay(messages);

    expect(hydrated[0]?._attachedFiles).toBeUndefined();
    expect(hydrated[100]?._attachedFiles).toEqual([{
      fileName: 'recent.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 123,
      preview: null,
      filePath: '/tmp/reports/recent.xlsx',
      exists: true,
    }]);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/files/thumbnails', expect.objectContaining({
      body: JSON.stringify({
        paths: [{
          filePath: '/tmp/reports/recent.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }],
      }),
    }));
    expect(String(hostApiFetchMock.mock.calls[0]?.[1]?.body)).not.toContain('/tmp/reports/old.xlsx');
  });

  it('drops persisted assistant artifacts outside the history artifact window', () => {
    const messages: RawMessage[] = Array.from({ length: 101 }, (_, index) => ({
      role: 'assistant',
      content: `消息 ${index}`,
      _attachedFiles: index === 0
        ? [{
            fileName: 'old.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileSize: 123,
            preview: null,
            filePath: '/tmp/reports/old.xlsx',
            exists: true,
          }]
        : undefined,
    }));

    const prepared = prepareHistoryMessagesForDisplay(messages);

    expect(prepared[0]?._attachedFiles).toBeUndefined();
  });

  it('does not create runtime file cards from skill marker paths in history preparation', () => {
    const messages = [
      {
        role: 'user',
        content: '[[use skill: find-skills (/Users/lsave/.openclaw-geeclaw/skills/find-skills/SKILL.md)]]',
      },
      {
        role: 'assistant',
        content: '我已经读取完毕。',
      },
    ] as RawMessage[];

    const prepared = prepareHistoryMessagesForDisplay(messages);

    expect(prepared[1]?._attachedFiles).toBeUndefined();
  });

  it('does not hide reserved attachment marker files after they are classified as artifacts', () => {
    const files = [
      {
        fileName: 'SKILL.md',
        mimeType: 'text/markdown',
        fileSize: 12,
        preview: null,
        filePath: '/tmp/SKILL.md',
      },
      {
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        fileSize: 34,
        preview: null,
        filePath: '/tmp/report.pdf',
      },
    ];

    const limited = limitAttachedFilesForMessage(files);

    expect(limited.files).toEqual(files);
    expect(limited.hiddenCount).toBe(0);
  });
});
