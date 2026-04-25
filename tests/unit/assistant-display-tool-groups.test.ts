import { describe, expect, it } from 'vitest';
import { buildAssistantDisplayModel } from '@/pages/Chat/assistant-display';
import type { RawMessage } from '@/stores/chat';

describe('buildAssistantDisplayModel', () => {
  it('collapses a tool group once later assistant text appears during streaming', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will inspect the file first.' },
        { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { filePath: '/tmp/a.ts' } },
        { type: 'toolResult', id: 'tool-1', name: 'read', text: 'export const value = 1;' },
        { type: 'text', text: 'Now I can explain what I found.' },
      ],
      _toolStatuses: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          name: 'read',
          status: 'completed',
          result: 'export const value = 1;',
          updatedAt: 1,
          input: { filePath: '/tmp/a.ts' },
        },
      ],
    } as unknown as RawMessage;

    const display = buildAssistantDisplayModel(message, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: true,
      liveToolMessages: [],
      liveStreamSegments: [],
    });

    expect(display.parts).toEqual([
      expect.objectContaining({ type: 'text', text: 'I will inspect the file first.' }),
      expect.objectContaining({ type: 'tool_group', collapsed: true, summary: 'Read 1 file' }),
      expect.objectContaining({ type: 'text', text: 'Now I can explain what I found.' }),
    ]);
  });

  it('keeps the tail tool group expanded while it is still active', () => {
    const display = buildAssistantDisplayModel(null, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: true,
      liveToolMessages: [
        {
          role: 'assistant',
          id: 'live-tool:tool-1',
          toolCallId: 'tool-1',
          toolName: 'exec',
          timestamp: 1,
          content: [
            { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'pwd' } },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'exec',
              status: 'running',
              updatedAt: 1,
              input: { command: 'pwd' },
            },
          ],
        } as RawMessage,
      ],
      liveStreamSegments: [{ text: 'I am checking the working directory.', ts: 0 }],
    });

    expect(display.parts).toEqual([
      expect.objectContaining({ type: 'text', text: 'I am checking the working directory.' }),
      expect.objectContaining({
        type: 'tool_group',
        collapsed: false,
        summary: 'Ran 1 command',
      }),
    ]);
  });

  it('collapses all tool groups when the turn is no longer streaming', () => {
    const display = buildAssistantDisplayModel(null, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: false,
      liveToolMessages: [
        {
          role: 'assistant',
          id: 'live-tool:tool-1',
          toolCallId: 'tool-1',
          toolName: 'exec',
          timestamp: 1,
          content: [
            { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'pwd' } },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'exec',
              status: 'completed',
              result: '/workspace',
              updatedAt: 2,
              input: { command: 'pwd' },
            },
          ],
        } as RawMessage,
      ],
      liveStreamSegments: [{ text: 'I am checking the working directory.', ts: 0 }],
    });

    expect(display.parts).toEqual([
      expect.objectContaining({ type: 'text', text: 'I am checking the working directory.' }),
      expect.objectContaining({
        type: 'tool_group',
        collapsed: true,
        summary: 'Ran 1 command',
      }),
    ]);
  });
});
