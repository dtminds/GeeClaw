import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetChatRuntimeGuardsForTests, useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';

const initialChatState = useChatStore.getState();
const initialGatewayState = useGatewayStore.getState();

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('chat abort race handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetChatRuntimeGuardsForTests();
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState(initialGatewayState, true);
    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: 'desktop-test',
      currentViewMode: 'session',
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

  it('ignores stale chat events from a run after the user aborts it', async () => {
    const rpcMock = vi.fn(async () => undefined);
    useGatewayStore.setState({ rpc: rpcMock });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-aborted',
    });

    await useChatStore.getState().abortRun();

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-aborted',
      sessionKey: 'agent:test:geeclaw_main',
      message: {
        role: 'assistant',
        content: 'late response',
        timestamp: 1,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: false,
      activeRunId: null,
      streamingText: '',
    });
  });

  it('ignores stale tool events from a run after the user aborts it', async () => {
    const rpcMock = vi.fn(async () => undefined);
    useGatewayStore.setState({ rpc: rpcMock });
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-aborted',
    });

    await useChatStore.getState().abortRun();

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-aborted',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'start',
        args: { command: 'pwd' },
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: false,
      activeRunId: null,
      toolMessages: [],
    });
  });

  it('does not bind a run id when chat.send resolves after the user already aborted', async () => {
    const sendResult = createDeferred<{ runId: string }>();
    const rpcMock = vi.fn((method: string) => {
      if (method === 'chat.send') {
        return sendResult.promise;
      }
      if (method === 'chat.abort') {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected RPC method: ${method}`));
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      currentSessionKey: 'cron:test',
      currentDesktopSessionId: '',
      currentViewMode: 'cron',
    });

    const sendPromise = useChatStore.getState().sendMessage('hello');
    await Promise.resolve();
    await useChatStore.getState().abortRun();

    sendResult.resolve({ runId: 'run-returned-late' });
    await sendPromise;

    expect(useChatStore.getState()).toMatchObject({
      sending: false,
      activeRunId: null,
      streamingText: '',
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-returned-late',
      sessionKey: 'cron:test',
      message: {
        role: 'assistant',
        content: 'late response',
        timestamp: 1,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: false,
      activeRunId: null,
      streamingText: '',
    });
  });

  it('keeps newer run events queued when an older chat.send resolves after a resend starts', async () => {
    const firstSendResult = createDeferred<{ runId: string }>();
    const secondSendResult = createDeferred<{ runId: string }>();
    const pendingSends = [firstSendResult, secondSendResult];
    const rpcMock = vi.fn((method: string) => {
      if (method === 'chat.send') {
        const nextSend = pendingSends.shift();
        if (!nextSend) {
          return Promise.reject(new Error('Unexpected extra chat.send'));
        }
        return nextSend.promise;
      }
      if (method === 'chat.abort') {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected RPC method: ${method}`));
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      currentSessionKey: 'cron:test',
      currentDesktopSessionId: '',
      currentViewMode: 'cron',
    });

    const firstSendPromise = useChatStore.getState().sendMessage('first');
    await Promise.resolve();
    await useChatStore.getState().abortRun();
    const secondSendPromise = useChatStore.getState().sendMessage('second');
    await Promise.resolve();

    firstSendResult.resolve({ runId: 'run-old' });
    await firstSendPromise;

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-new',
      sessionKey: 'cron:test',
      message: {
        role: 'assistant',
        content: 'new response',
        timestamp: 1,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: null,
      streamingText: '',
    });

    secondSendResult.resolve({ runId: 'run-new' });
    await secondSendPromise;
    await Promise.resolve();

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-new',
      streamingText: 'new response',
    });
  });

  it('keeps newer run events queued when an older abort confirmation arrives after a resend starts', async () => {
    const secondSendResult = createDeferred<{ runId: string }>();
    const rpcMock = vi.fn((method: string) => {
      if (method === 'chat.send') {
        return secondSendResult.promise;
      }
      if (method === 'chat.abort') {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected RPC method: ${method}`));
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      currentSessionKey: 'cron:test',
      currentDesktopSessionId: '',
      currentViewMode: 'cron',
      sending: true,
      activeRunId: null,
    });

    await useChatStore.getState().abortRun();
    const secondSendPromise = useChatStore.getState().sendMessage('second');
    await Promise.resolve();

    useChatStore.getState().handleChatEvent({
      state: 'aborted',
      runId: 'run-old',
      sessionKey: 'cron:test',
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-new',
      sessionKey: 'cron:test',
      message: {
        role: 'assistant',
        content: 'new response',
        timestamp: 1,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: null,
      streamingText: '',
    });

    secondSendResult.resolve({ runId: 'run-new' });
    await secondSendPromise;
    await Promise.resolve();

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      activeRunId: 'run-new',
      streamingText: 'new response',
    });
  });
});
