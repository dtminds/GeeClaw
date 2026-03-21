import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearErrorRecoveryTimer = vi.fn();
const clearHistoryPoll = vi.fn();
const extractImagesAsAttachedFiles = vi.fn(() => []);
const extractMediaRefs = vi.fn(() => []);
const extractRawFilePaths = vi.fn(() => []);
const getMessageText = vi.fn((content: unknown) => (typeof content === 'string' ? content : ''));
const hasEquivalentFinalAssistantMessage = vi.fn(() => false);
const getToolCallInput = vi.fn(() => undefined);
const hasErrorRecoveryTimer = vi.fn(() => false);
const hasNonToolAssistantContent = vi.fn(() => true);
const isErroredToolResult = vi.fn(() => false);
const isToolOnlyMessage = vi.fn(() => false);
const isToolResultRole = vi.fn((role: unknown) => role === 'toolresult');
const limitAttachedFilesForMessage = vi.fn((files, hiddenCount = 0) => ({ files, hiddenCount }));
const makeAttachedFile = vi.fn((ref: { filePath: string; mimeType: string }) => ({
  fileName: ref.filePath.split('/').pop() || 'file',
  mimeType: ref.mimeType,
  fileSize: 0,
  preview: null,
  filePath: ref.filePath,
}));
const resolveToolLikeName = vi.fn((message: { toolName?: string; name?: string }) => message.toolName ?? message.name);
const setErrorRecoveryTimer = vi.fn();
const stripRenderedPrefixFromStreamingText = vi.fn((text: string) => text);
const shouldDisplayToolResultFileRef = vi.fn(() => true);
const shouldExtractRawFilePathsForTool = vi.fn(() => true);

vi.mock('@/stores/chat/helpers', () => ({
  clearErrorRecoveryTimer: (...args: unknown[]) => clearErrorRecoveryTimer(...args),
  clearHistoryPoll: (...args: unknown[]) => clearHistoryPoll(...args),
  extractImagesAsAttachedFiles: (...args: unknown[]) => extractImagesAsAttachedFiles(...args),
  extractMediaRefs: (...args: unknown[]) => extractMediaRefs(...args),
  extractRawFilePaths: (...args: unknown[]) => extractRawFilePaths(...args),
  getMessageText: (...args: unknown[]) => getMessageText(...args),
  hasEquivalentFinalAssistantMessage: (...args: unknown[]) => hasEquivalentFinalAssistantMessage(...args),
  getToolCallInput: (...args: unknown[]) => getToolCallInput(...args),
  hasErrorRecoveryTimer: (...args: unknown[]) => hasErrorRecoveryTimer(...args),
  hasNonToolAssistantContent: (...args: unknown[]) => hasNonToolAssistantContent(...args),
  isErroredToolResult: (...args: unknown[]) => isErroredToolResult(...args),
  isToolOnlyMessage: (...args: unknown[]) => isToolOnlyMessage(...args),
  isToolResultRole: (...args: unknown[]) => isToolResultRole(...args),
  limitAttachedFilesForMessage: (...args: unknown[]) => limitAttachedFilesForMessage(...args),
  makeAttachedFile: (...args: unknown[]) => makeAttachedFile(...args),
  resolveToolLikeName: (...args: unknown[]) => resolveToolLikeName(...args),
  setErrorRecoveryTimer: (...args: unknown[]) => setErrorRecoveryTimer(...args),
  stripRenderedPrefixFromStreamingText: (...args: unknown[]) => stripRenderedPrefixFromStreamingText(...args),
  shouldDisplayToolResultFileRef: (...args: unknown[]) => shouldDisplayToolResultFileRef(...args),
  shouldExtractRawFilePathsForTool: (...args: unknown[]) => shouldExtractRawFilePathsForTool(...args),
}));

type ChatLikeState = {
  sending: boolean;
  activeRunId: string | null;
  error: string | null;
  messages: Array<Record<string, any>>;
  pendingToolImages: unknown[];
  pendingToolHiddenCount: number;
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  streamingText: string;
  streamingTextStartedAt: number | null;
  streamSegments: Array<{ text: string; ts: number }>;
  toolStreamById: Map<string, unknown>;
  toolStreamOrder: string[];
  toolMessages: Array<Record<string, any>>;
  loadHistory: ReturnType<typeof vi.fn>;
};

function makeHarness(initial?: Partial<ChatLikeState>) {
  let state: ChatLikeState = {
    sending: false,
    activeRunId: null,
    error: 'stale error',
    messages: [],
    pendingToolImages: [],
    pendingToolHiddenCount: 0,
    pendingFinal: false,
    lastUserMessageAt: null,
    streamingText: '',
    streamingTextStartedAt: null,
    streamSegments: [],
    toolStreamById: new Map(),
    toolStreamOrder: [],
    toolMessages: [],
    loadHistory: vi.fn(),
    ...initial,
  };

  const set = (partial: Partial<ChatLikeState> | ((s: ChatLikeState) => Partial<ChatLikeState>)) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  return { set, get, read: () => state };
}

describe('chat runtime event handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hasErrorRecoveryTimer.mockReturnValue(false);
    hasEquivalentFinalAssistantMessage.mockReturnValue(false);
    resolveToolLikeName.mockImplementation((message: { toolName?: string; name?: string }) => message.toolName ?? message.name);
    stripRenderedPrefixFromStreamingText.mockImplementation((text: string) => text);
    shouldDisplayToolResultFileRef.mockReturnValue(true);
    shouldExtractRawFilePathsForTool.mockReturnValue(true);
    getMessageText.mockImplementation((content: unknown) => (typeof content === 'string' ? content : ''));
  });

  it('marks sending on started event', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({ sending: false, activeRunId: null, error: 'err' });

    handleRuntimeEventState(h.set as never, h.get as never, {}, 'started', 'run-1');
    const next = h.read();
    expect(next.sending).toBe(true);
    expect(next.activeRunId).toBe('run-1');
    expect(next.error).toBeNull();
  });

  it('applies delta text and clears stale error when recovery timer exists', async () => {
    hasErrorRecoveryTimer.mockReturnValue(true);

    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({ error: 'old' });
    const event = { message: { role: 'assistant', content: 'delta' } };

    handleRuntimeEventState(h.set as never, h.get as never, event, 'delta', 'run-2');
    const next = h.read();
    expect(clearErrorRecoveryTimer).toHaveBeenCalledTimes(1);
    expect(next.error).toBeNull();
    expect(next.streamingText).toBe('delta');
    expect(next.streamingTextStartedAt).not.toBeNull();
  });

  it('loads history and clears live state when final event has no message', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      sending: true,
      activeRunId: 'run-3',
      streamingText: 'partial',
      toolMessages: [{ id: 'live-tool:1' }],
    });

    handleRuntimeEventState(h.set as never, h.get as never, {}, 'final', 'run-3');
    const next = h.read();
    expect(next.pendingFinal).toBe(false);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.streamingText).toBe('');
    expect(next.toolMessages).toEqual([]);
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('handles error event and finalizes immediately when not sending', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({ sending: false, activeRunId: 'r1', lastUserMessageAt: 123 });

    handleRuntimeEventState(h.set as never, h.get as never, { errorMessage: 'boom' }, 'error', 'r1');
    const next = h.read();
    expect(clearHistoryPoll).toHaveBeenCalledTimes(1);
    expect(next.error).toBe('boom');
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.lastUserMessageAt).toBeNull();
    expect(next.toolMessages).toEqual([]);
  });

  it('clears runtime state on aborted event', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      sending: true,
      activeRunId: 'r2',
      streamingText: 'abc',
      streamSegments: [{ text: 'one', ts: 1 }],
      toolMessages: [{ id: 'live-tool:t1' }],
      pendingFinal: true,
      lastUserMessageAt: 5,
      pendingToolImages: [{ fileName: 'x' }],
    });

    handleRuntimeEventState(h.set as never, h.get as never, {}, 'aborted', 'r2');
    const next = h.read();
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.streamingText).toBe('');
    expect(next.streamSegments).toEqual([]);
    expect(next.toolMessages).toEqual([]);
    expect(next.pendingFinal).toBe(false);
    expect(next.lastUserMessageAt).toBeNull();
    expect(next.pendingToolImages).toEqual([]);
  });

  it('flushes current text into a segment when the first tool event arrives', async () => {
    const { handleRuntimeToolEvent } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      sending: true,
      streamingText: 'text before tool',
      streamingTextStartedAt: 123,
    });

    handleRuntimeToolEvent(h.set as never, h.get as never, {
      runId: 'run-4',
      ts: 456,
      data: {
        toolCallId: 'tool-1',
        name: 'bash',
        phase: 'start',
        args: { command: 'pwd' },
      },
    });

    const next = h.read();
    expect(next.streamSegments).toEqual([{ text: 'text before tool', ts: 123 }]);
    expect(next.streamingText).toBe('');
    expect(next.toolMessages).toHaveLength(1);
    expect(next.toolMessages[0].toolCallId).toBe('tool-1');
  });

  it('updates the existing tool card instead of inserting duplicates', async () => {
    const { handleRuntimeToolEvent } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness();

    handleRuntimeToolEvent(h.set as never, h.get as never, {
      runId: 'run-5',
      ts: 100,
      data: {
        toolCallId: 'tool-1',
        name: 'fetch',
        phase: 'start',
        args: { url: 'https://example.com' },
      },
    });
    handleRuntimeToolEvent(h.set as never, h.get as never, {
      runId: 'run-5',
      ts: 120,
      data: {
        toolCallId: 'tool-1',
        name: 'fetch',
        phase: 'update',
        partialResult: { text: 'working' },
      },
    });

    const next = h.read();
    expect(next.toolMessages).toHaveLength(1);
    expect(next.toolMessages[0]._toolStatuses?.[0]).toMatchObject({
      toolCallId: 'tool-1',
      status: 'running',
      result: 'working',
    });
  });

  it('preserves the chat run id after a tool event so later text deltas still render', async () => {
    const { handleRuntimeEventState, handleRuntimeToolEvent } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      sending: true,
      activeRunId: 'chat-run-1',
      streamingText: '第一段文字',
      streamingTextStartedAt: 100,
    });

    handleRuntimeToolEvent(h.set as never, h.get as never, {
      runId: 'tool-run-1',
      ts: 120,
      data: {
        toolCallId: 'tool-1',
        name: 'bash',
        phase: 'start',
        args: { command: 'pwd' },
      },
    });

    expect(h.read().activeRunId).toBe('chat-run-1');

    handleRuntimeEventState(h.set as never, h.get as never, {
      runId: 'chat-run-1',
      message: { role: 'assistant', content: '第二段文字' },
    }, 'delta', 'chat-run-1');

    const next = h.read();
    expect(next.toolMessages).toHaveLength(1);
    expect(next.streamingText).toBe('第二段文字');
  });

  it('strips already-rendered segment prefixes from post-tool deltas', async () => {
    stripRenderedPrefixFromStreamingText.mockImplementation((text: string, segments: Array<{ text: string }>) => {
      const suffix = segments.map((segment) => segment.text).join('');
      return text.startsWith(suffix) ? text.slice(suffix.length) : text;
    });

    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      sending: true,
      streamSegments: [{ text: '上海多云，约 15°C，午后防雨。🪻查 X 登录中。', ts: 1 }],
      streamingText: '',
    });

    handleRuntimeEventState(h.set as never, h.get as never, {
      message: {
        role: 'assistant',
        content: '上海多云，约 15°C，午后防雨。🪻查 X 登录中。X 登录正常。✅',
      },
    }, 'delta', 'run-8');

    expect(h.read().streamingText).toBe('X 登录正常。✅');
  });

  it('does not append a duplicate assistant final when history already contains the same reply', async () => {
    hasEquivalentFinalAssistantMessage.mockReturnValue(true);

    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      sending: true,
      activeRunId: 'run-7',
      messages: [
        {
          role: 'assistant',
          id: 'history-assistant-1',
          content: '你好 BOSS! 我是 YY。',
          timestamp: 123,
        },
      ],
      streamingText: '你好 BOSS! 我是 YY。',
      streamingTextStartedAt: 123,
    });

    handleRuntimeEventState(h.set as never, h.get as never, {
      message: {
        role: 'assistant',
        content: '你好 BOSS! 我是 YY。',
        timestamp: 123,
      },
    }, 'final', 'run-7');

    const next = h.read();
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].id).toBe('history-assistant-1');
    expect(next.streamingText).toBe('');
    expect(next.sending).toBe(false);
  });

  it('skips raw-path extraction for blocked exec tool results', async () => {
    getMessageText.mockReturnValue('/tmp/exports/a.png');
    getToolCallInput.mockReturnValue({ command: 'find /tmp -name "*.png"' });
    extractRawFilePaths.mockReturnValue([{ filePath: '/tmp/exports/a.png', mimeType: 'image/png' }]);
    shouldExtractRawFilePathsForTool.mockReturnValue(false);

    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness();

    handleRuntimeEventState(h.set as never, h.get as never, {
      message: {
        role: 'toolresult',
        toolCallId: 'tool-find',
        toolName: 'exec',
        content: '/tmp/exports/a.png',
      },
    }, 'final', 'run-6');

    expect(shouldExtractRawFilePathsForTool).toHaveBeenCalledWith('exec', { command: 'find /tmp -name "*.png"' });
    expect(extractRawFilePaths).not.toHaveBeenCalled();
    expect(h.read().pendingToolImages).toEqual([]);
  });
});
