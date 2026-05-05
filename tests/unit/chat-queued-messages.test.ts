import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetChatRuntimeGuardsForTests, useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';

const initialChatState = useChatStore.getState();
const initialGatewayState = useGatewayStore.getState();

describe('chat queued follow-up messages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetChatRuntimeGuardsForTests();
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState(initialGatewayState, true);
    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'cron',
      currentAgentId: 'test',
      desktopSessions: [],
      messages: [],
    });
  });

  afterEach(() => {
    useChatStore.setState({ sending: false });
    __resetChatRuntimeGuardsForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('queues a follow-up while a run is active and flushes it after the active run finishes', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-next' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
    });

    await useChatStore.getState().sendMessage('next question');

    expect(rpcMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().queuedMessages).toHaveLength(1);
    expect(useChatStore.getState().queuedMessages[0]).toMatchObject({
      text: 'next question',
      targetAgentId: null,
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'done',
        timestamp: 1,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(useChatStore.getState().queuedMessages).toHaveLength(0);
    expect(rpcMock).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'agent:test:geeclaw_main',
        message: 'next question',
        deliver: false,
      }),
      120_000,
    );
  });

  it('does not queue more than one follow-up while a run is active', async () => {
    const rpcMock = vi.fn(async () => ({}));
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'already queued',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().sendMessage('second queued message');

    expect(rpcMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().queuedMessages).toEqual([
      expect.objectContaining({
        id: 'queued-1',
        text: 'already queued',
      }),
    ]);
  });

  it('flushes a queued follow-up after an active run is aborted by an event', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-next' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'continue after abort',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    useChatStore.getState().handleChatEvent({
      state: 'aborted',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(useChatStore.getState().queuedMessages).toHaveLength(0);
    expect(rpcMock).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        message: 'continue after abort',
      }),
      120_000,
    );
  });

  it('flushes a queued follow-up when history reload observes the final assistant response', async () => {
    const userSentAt = Date.now();
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.history') {
        return {
          messages: [
            {
              role: 'user',
              content: 'first question',
              timestamp: 1,
            },
            {
              role: 'assistant',
              content: 'first answer',
              timestamp: (userSentAt + 1000) / 1000,
            },
          ],
        };
      }
      if (method === 'chat.send') {
        return { runId: 'run-next' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      pendingFinal: true,
      lastUserMessageAt: userSentAt,
      selectedCronRun: null,
      queuedMessages: [{
        id: 'queued-1',
        text: 'next question',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().loadHistory(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(useChatStore.getState().queuedMessages).toHaveLength(0);
    expect(useChatStore.getState().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'next question',
        }),
      ]),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'agent:test:geeclaw_main',
        message: 'next question',
        deliver: false,
      }),
      120_000,
    );
  });

  it('flushes a queued follow-up after a terminal assistant error event', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-next' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'continue after error',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    useChatStore.getState().handleChatEvent({
      state: 'error',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: '',
        stopReason: 'error',
        isError: true,
        timestamp: 1,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(useChatStore.getState().queuedMessages).toHaveLength(0);
    expect(rpcMock).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        message: 'continue after error',
      }),
      120_000,
    );
  });

  it('clears queued follow-ups and aborts the active run id when stopped', async () => {
    const rpcMock = vi.fn(async () => undefined);
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'next question',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().abortRun();

    expect(useChatStore.getState().queuedMessages).toEqual([]);
    expect(rpcMock).toHaveBeenCalledWith('chat.abort', {
      sessionKey: 'agent:test:geeclaw_main',
      runId: 'run-active',
    });
  });

  it('marks a queued message as steered until the active run finishes', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-steer' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().steerQueuedMessage('queued-1');

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        kind: 'steered',
        pendingRunId: 'run-active',
      }],
    });
    expect(rpcMock).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'agent:test:geeclaw_main',
        message: 'adjust course',
        deliver: false,
      }),
      120_000,
    );

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'done',
        timestamp: 1,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: null,
      queuedMessages: [],
    });
    expect(useChatStore.getState().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'done',
        }),
        expect.objectContaining({
          role: 'user',
          content: 'adjust course',
        }),
      ]),
    );
  });

  it('keeps session tool fallback open after steering until the next run can stream', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-steer' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      currentViewMode: 'session',
      currentDesktopSessionId: 'desktop-test',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().steerQueuedMessage('queued-1');

    expect(rpcMock).toHaveBeenCalledWith('sessions.subscribe', {});

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'active done',
        timestamp: 1,
      },
    });

    await vi.advanceTimersByTimeAsync(3_000);

    expect(rpcMock).not.toHaveBeenCalledWith('sessions.unsubscribe', {});
  });

  it('does not surface steered transcript user messages before the active run finishes', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-steer' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().steerQueuedMessage('queued-1');

    useChatStore.getState().handleSessionMessageEvent({
      key: 'agent:test:geeclaw_main',
      message: {
        id: 'persisted-steer-user',
        role: 'user',
        content: 'adjust course',
        timestamp: 1.5,
      },
    });

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().queuedMessages).toEqual([
      expect.objectContaining({
        id: 'queued-1',
        kind: 'steered',
        pendingRunId: 'run-active',
      }),
    ]);

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'done',
        timestamp: 2,
      },
    });

    expect(useChatStore.getState().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'adjust course',
        }),
      ]),
    );
  });

  it('adopts the actual steer run id from the first post-terminal stream event', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-ack' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().steerQueuedMessage('queued-1');
    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'active done',
        timestamp: 1,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: null,
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-actual',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'actual steer response',
        timestamp: 2,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-actual',
      streamingText: 'actual steer response',
    });
  });

  it('does not bind the steered turn to the empty ack run final', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-ack' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().steerQueuedMessage('queued-1');
    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-ack',
      sessionKey: 'agent:test:geeclaw_main',
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        kind: 'steered',
        pendingRunId: 'run-active',
      }],
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'active done',
        timestamp: 1,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: null,
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-actual',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'actual steer response',
        timestamp: 2,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-actual',
      streamingText: 'actual steer response',
    });
  });

  it('buffers steered tool events that arrive before the original run finishes', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-ack' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().steerQueuedMessage('queued-1');

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-actual',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'start',
        args: { command: 'pwd' },
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      activeRunId: 'run-active',
    });
    expect(useChatStore.getState().toolMessages).toHaveLength(0);

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'active done',
        timestamp: 1,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: null,
    });
    expect(useChatStore.getState().toolMessages).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-1',
        toolName: 'exec',
      }),
    ]);
  });

  it('keeps a steered user turn visible when the adopted run emits an empty final', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-ack' };
      }
      if (method === 'chat.history') {
        return {
          messages: [
            {
              role: 'user',
              content: 'first question',
              timestamp: 1,
            },
            {
              role: 'assistant',
              content: 'active done',
              timestamp: 2,
            },
          ],
        };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().steerQueuedMessage('queued-1');
    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'active done',
        timestamp: 2,
      },
    });
    useChatStore.getState().handleChatEvent({
      state: 'started',
      runId: 'run-actual',
      sessionKey: 'agent:test:geeclaw_main',
    });
    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-actual',
      sessionKey: 'agent:test:geeclaw_main',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-actual',
      pendingFinal: true,
    });
    expect(useChatStore.getState().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'adjust course',
        }),
      ]),
    );
  });

  it('ignores steer send run events while the original active run is still pending', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') {
        return { runId: 'run-steer' };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-active',
      queuedMessages: [{
        id: 'queued-1',
        text: 'adjust course',
        attachments: undefined,
        targetAgentId: null,
        createdAt: 1,
      }],
    } as never);

    await useChatStore.getState().steerQueuedMessage('queued-1');

    useChatStore.getState().handleChatEvent({
      state: 'started',
      runId: 'run-steer',
      sessionKey: 'agent:test:geeclaw_main',
    });
    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-steer',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'steered response',
        timestamp: 2,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-active',
      streamingText: '',
      queuedMessages: [{
        id: 'queued-1',
        kind: 'steered',
        pendingRunId: 'run-active',
        steerRunId: 'run-steer',
      }],
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-active',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'active run done',
        timestamp: 1,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-steer',
      streamingText: 'steered response',
      queuedMessages: [],
    });
    expect(useChatStore.getState().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'adjust course',
        }),
      ]),
    );
  });
});
