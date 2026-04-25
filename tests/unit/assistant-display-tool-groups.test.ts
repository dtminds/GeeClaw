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
  it('keeps inline errored tool results marked as error even when they include text, an error payload, or a failed status', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'cat missing.txt' } },
        { type: 'toolResult', id: 'tool-1', name: 'exec', text: 'cat: missing.txt: No such file or directory', status: 'error' },
        { type: 'toolCall', id: 'tool-2', name: 'exec', arguments: { command: 'ls /missing' } },
        { type: 'toolResult', id: 'tool-2', name: 'exec', error: 'ls: /missing: No such file or directory' },
        { type: 'toolCall', id: 'tool-3', name: 'exec', arguments: { command: 'python broken.py' } },
        { type: 'toolResult', id: 'tool-3', name: 'exec', text: 'Traceback: boom', status: 'failed' },
      ],
      _toolStatuses: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          name: 'exec',
          status: 'running',
          updatedAt: 1,
          input: { command: 'cat missing.txt' },
        },
        {
          id: 'tool-2',
          toolCallId: 'tool-2',
          name: 'exec',
          status: 'running',
          updatedAt: 2,
          input: { command: 'ls /missing' },
        },
        {
          id: 'tool-3',
          toolCallId: 'tool-3',
          name: 'exec',
          status: 'running',
          updatedAt: 3,
          input: { command: 'python broken.py' },
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
      expect.objectContaining({
        type: 'tool_group',
        items: [
          expect.objectContaining({
            id: 'tool-1',
            status: 'error',
            result: 'cat: missing.txt: No such file or directory',
          }),
          expect.objectContaining({
            id: 'tool-2',
            status: 'error',
            result: 'ls: /missing: No such file or directory',
          }),
          expect.objectContaining({
            id: 'tool-3',
            status: 'error',
            result: 'Traceback: boom',
          }),
        ],
      }),
    ]);
  });

  it('restores top-level tool_calls fallback for content arrays that only contain text', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I looked up the page for you.' },
      ],
      tool_calls: [
        {
          id: 'tool-1',
          function: {
            name: 'fetch',
            arguments: JSON.stringify({ url: 'https://example.com' }),
          },
        },
      ],
      _toolStatuses: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          name: 'fetch',
          status: 'completed',
          result: 'ok',
          updatedAt: 1,
          input: { url: 'https://example.com' },
        },
      ],
    } as unknown as RawMessage;

    const display = buildAssistantDisplayModel(message, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: false,
      liveToolMessages: [],
      liveStreamSegments: [],
    });

    expect(display.parts).toEqual([
      expect.objectContaining({
        type: 'tool_group',
        collapsed: true,
        summary: 'Made 1 web request',
        items: [
          expect.objectContaining({
            id: 'tool-1',
            name: 'fetch',
            status: 'completed',
          }),
        ],
      }),
      expect.objectContaining({ type: 'text', text: 'I looked up the page for you.' }),
    ]);
  });
  it('keeps distinct top-level tool_calls with the same tool name when ids differ', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I fetched two pages for comparison.' },
      ],
      tool_calls: [
        {
          id: 'tool-1',
          function: {
            name: 'fetch',
            arguments: JSON.stringify({ url: 'https://example.com/a' }),
          },
        },
        {
          id: 'tool-2',
          function: {
            name: 'fetch',
            arguments: JSON.stringify({ url: 'https://example.com/b' }),
          },
        },
      ],
      _toolStatuses: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          name: 'fetch',
          status: 'completed',
          result: 'ok',
          updatedAt: 1,
          input: { url: 'https://example.com/a' },
        },
        {
          id: 'tool-2',
          toolCallId: 'tool-2',
          name: 'fetch',
          status: 'completed',
          result: 'ok',
          updatedAt: 2,
          input: { url: 'https://example.com/b' },
        },
      ],
    } as unknown as RawMessage;

    const display = buildAssistantDisplayModel(message, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: false,
      liveToolMessages: [],
      liveStreamSegments: [],
    });

    expect(display.parts).toEqual([
      expect.objectContaining({
        type: 'tool_group',
        summary: 'Made 2 web requests',
        items: [
          expect.objectContaining({ id: 'tool-1', name: 'fetch' }),
          expect.objectContaining({ id: 'tool-2', name: 'fetch' }),
        ],
      }),
      expect.objectContaining({ type: 'text', text: 'I fetched two pages for comparison.' }),
    ]);
  });

  it('renders the same collapsed tool summary after finalization and history reload', () => {
    const finalMessage = {
      role: 'assistant',
      id: 'assistant-final-summary',
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

    const finalDisplay = buildAssistantDisplayModel(finalMessage, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: false,
      liveToolMessages: [],
      liveStreamSegments: [],
    });
    const reloadedDisplay = buildAssistantDisplayModel(
      {
        ...finalMessage,
        content: [...finalMessage.content],
        _toolStatuses: [...(finalMessage._toolStatuses || [])],
      } as RawMessage,
      {
        showThinking: false,
        showToolCalls: true,
        isStreaming: false,
        liveToolMessages: [],
        liveStreamSegments: [],
      },
    );

    expect(finalDisplay.parts).toEqual(reloadedDisplay.parts);
    expect(finalDisplay.parts).toContainEqual(expect.objectContaining({
      type: 'tool_group',
      collapsed: true,
      summary: 'Read 1 file',
    }));
  });

  it('summarizes mixed tool groups with edits before commands and web access', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tool-edit-1', name: 'edit', arguments: { filePath: '/tmp/a.ts' } },
        { type: 'toolResult', id: 'tool-edit-1', name: 'edit', text: 'ok' },
        { type: 'toolCall', id: 'tool-edit-2', name: 'write', arguments: { filePath: '/tmp/b.ts' } },
        { type: 'toolResult', id: 'tool-edit-2', name: 'write', text: 'ok' },
        { type: 'toolCall', id: 'tool-edit-3', name: 'apply_patch', arguments: { targetFile: '/tmp/c.ts' } },
        { type: 'toolResult', id: 'tool-edit-3', name: 'apply_patch', text: 'ok' },
        { type: 'toolCall', id: 'tool-command-1', name: 'exec', arguments: { command: 'pwd' } },
        { type: 'toolResult', id: 'tool-command-1', name: 'exec', text: '/workspace' },
        { type: 'toolCall', id: 'tool-command-2', name: 'bash', arguments: { command: 'ls' } },
        { type: 'toolResult', id: 'tool-command-2', name: 'bash', text: 'src' },
        { type: 'toolCall', id: 'tool-web-1', name: 'fetch', arguments: { url: 'https://example.com' } },
        { type: 'toolResult', id: 'tool-web-1', name: 'fetch', text: 'ok' },
      ],
      _toolStatuses: [
        {
          id: 'tool-edit-1',
          toolCallId: 'tool-edit-1',
          name: 'edit',
          status: 'completed',
          updatedAt: 1,
          input: { filePath: '/tmp/a.ts' },
        },
        {
          id: 'tool-edit-2',
          toolCallId: 'tool-edit-2',
          name: 'write',
          status: 'completed',
          updatedAt: 2,
          input: { filePath: '/tmp/b.ts' },
        },
        {
          id: 'tool-edit-3',
          toolCallId: 'tool-edit-3',
          name: 'apply_patch',
          status: 'completed',
          updatedAt: 3,
          input: { targetFile: '/tmp/c.ts' },
        },
        {
          id: 'tool-command-1',
          toolCallId: 'tool-command-1',
          name: 'exec',
          status: 'completed',
          updatedAt: 4,
          input: { command: 'pwd' },
        },
        {
          id: 'tool-command-2',
          toolCallId: 'tool-command-2',
          name: 'bash',
          status: 'completed',
          updatedAt: 5,
          input: { command: 'ls' },
        },
        {
          id: 'tool-web-1',
          toolCallId: 'tool-web-1',
          name: 'fetch',
          status: 'completed',
          updatedAt: 6,
          input: { url: 'https://example.com' },
        },
      ],
    } as unknown as RawMessage;

    const display = buildAssistantDisplayModel(message, {
      showThinking: false,
      showToolCalls: true,
      isStreaming: false,
      liveToolMessages: [],
      liveStreamSegments: [],
    });

    expect(display.parts).toContainEqual(expect.objectContaining({
      type: 'tool_group',
      collapsed: true,
      summary: 'Edited 3 files, Ran 2 commands, Made 1 web request',
    }));
  });
});
