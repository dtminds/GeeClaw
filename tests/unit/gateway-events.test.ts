import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const handleChatEventMock = vi.fn();
const handleAgentEventMock = vi.fn();
const loadHistoryMock = vi.fn();
const setChatStateMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      handleChatEvent: handleChatEventMock,
      handleAgentEvent: handleAgentEventMock,
      loadHistory: loadHistoryMock,
      sending: false,
    }),
    setState: setChatStateMock,
  },
}));

describe('gateway store event wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('subscribes to host events through subscribeHostEvent on init', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 28788 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:status', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:error', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:notification', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:chat-message', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    handlers.get('gateway:status')?.({ state: 'stopped', port: 28788 });
    expect(useGatewayStore.getState().status.state).toBe('stopped');
  });

  it('routes agent chat payloads only through gateway:chat-message, while tool stream stays on notification', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 28788 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-1',
        sessionKey: 'session-1',
        state: 'delta',
        message: { role: 'assistant', content: 'hello' },
      },
    });
    await vi.dynamicImportSettled();

    expect(handleChatEventMock).not.toHaveBeenCalled();

    handlers.get('gateway:chat-message')?.({
      message: {
        runId: 'run-1',
        sessionKey: 'session-1',
        state: 'delta',
        message: { role: 'assistant', content: 'hello' },
      },
    });
    await vi.dynamicImportSettled();

    expect(handleChatEventMock).toHaveBeenCalledTimes(1);
    expect(handleChatEventMock).toHaveBeenCalledWith(expect.objectContaining({
      state: 'delta',
      message: expect.objectContaining({ content: 'hello' }),
    }));

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-1',
        sessionKey: 'session-1',
        stream: 'tool',
        data: {
          stream: 'tool',
          toolCallId: 'tool-1',
          name: 'bash',
          phase: 'start',
        },
      },
    });
    await vi.dynamicImportSettled();

    expect(handleAgentEventMock).toHaveBeenCalledTimes(1);
    expect(handleAgentEventMock).toHaveBeenCalledWith(expect.objectContaining({
      stream: 'tool',
      data: expect.objectContaining({
        toolCallId: 'tool-1',
        phase: 'start',
      }),
    }));
  });

  it('does not finalize chat state on lifecycle end notifications', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 28788 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-2',
        sessionKey: 'session-2',
        stream: 'lifecycle',
        data: {
          phase: 'end',
        },
      },
    });
    await vi.dynamicImportSettled();

    expect(loadHistoryMock).not.toHaveBeenCalled();
    expect(setChatStateMock).not.toHaveBeenCalled();
  });
});
