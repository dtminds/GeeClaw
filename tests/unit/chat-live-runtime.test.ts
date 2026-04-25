import { describe, expect, it } from 'vitest';

import {
  buildOrderedLiveAssistantContentBlocks,
  buildToolStreamMessage,
} from '@/stores/chat/live-runtime';
import type { ToolStreamEntry } from '@/stores/chat';

describe('chat live runtime helpers', () => {
  it('builds a synthetic assistant message for live tool stream entries', () => {
    const entry: ToolStreamEntry = {
      toolCallId: 'tool-1',
      runId: 'run-1',
      name: 'exec',
      args: { cmd: 'pwd' },
      output: '/tmp/project',
      status: 'completed',
      durationMs: 42,
      startedAt: 10,
      updatedAt: 20,
      message: {} as never,
    };

    expect(buildToolStreamMessage(entry)).toMatchObject({
      role: 'assistant',
      id: 'live-tool:tool-1',
      toolCallId: 'tool-1',
      toolName: 'exec',
      timestamp: 10,
      content: [
        { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { cmd: 'pwd' } },
        { type: 'toolResult', id: 'tool-1', name: 'exec', text: '/tmp/project', status: 'completed' },
      ],
      _toolStatuses: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          name: 'exec',
          status: 'completed',
          durationMs: 42,
          result: '/tmp/project',
          updatedAt: 20,
          input: { cmd: 'pwd' },
        },
      ],
    });
  });

  it('orders live text segments and tool blocks by timestamp', () => {
    const toolMessage = buildToolStreamMessage({
      toolCallId: 'tool-1',
      runId: 'run-1',
      name: 'exec',
      status: 'running',
      startedAt: 2,
      updatedAt: 2,
      message: {} as never,
    });

    expect(buildOrderedLiveAssistantContentBlocks(
      [{ text: 'first', ts: 1 }, { text: 'last', ts: 3 }],
      [toolMessage],
    )).toEqual([
      { type: 'text', text: 'first' },
      { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: {} },
      { type: 'text', text: 'last' },
    ]);
  });

  it('normalizes seconds and milliseconds when ordering live content', () => {
    const toolMessage = buildToolStreamMessage({
      toolCallId: 'tool-1',
      runId: 'run-1',
      name: 'exec',
      status: 'running',
      startedAt: 1_777_000_003,
      updatedAt: 1_777_000_003,
      message: {} as never,
    });

    expect(buildOrderedLiveAssistantContentBlocks(
      [{ text: 'from ms timestamp', ts: 1_777_000_002_000 }],
      [toolMessage],
    )).toEqual([
      { type: 'text', text: 'from ms timestamp' },
      { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: {} },
    ]);
  });
});
