import { describe, expect, it, vi } from 'vitest';
import {
  enrichWithToolResultFiles,
  extractRawFilePaths,
  limitAttachedFilesForMessage,
  loadMissingPreviews,
} from '@/stores/chat/helpers';
import type { RawMessage } from '@/stores/chat/types';

describe('chat file path extraction', () => {
  it('still extracts absolute file paths from prose', () => {
    const refs = extractRawFilePaths('Example image path: /path/to/slide-01.jpg');
    expect(refs.map((ref) => ref.filePath)).toEqual(['/path/to/slide-01.jpg']);
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

  it('filters attached files whose paths do not exist', async () => {
    vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
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

  it('keeps attached files whose paths exist', async () => {
    vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
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

  it('caps displayed attachments per message and records hidden count', () => {
    const files = Array.from({ length: 60 }, (_, index) => ({
      fileName: `file-${index}.txt`,
      mimeType: 'text/plain',
      fileSize: index,
      preview: null,
      filePath: `/tmp/file-${index}.txt`,
    }));

    const limited = limitAttachedFilesForMessage(files);

    expect(limited.files).toHaveLength(9);
    expect(limited.hiddenCount).toBe(51);
    expect(limited.files[0]?.fileName).toBe('file-0.txt');
    expect(limited.files[8]?.fileName).toBe('file-8.txt');
  });
});
