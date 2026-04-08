import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';

const initialChatState = useChatStore.getState();
const initialGatewayState = useGatewayStore.getState();

describe('chat send timeout recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState(initialGatewayState, true);
  });

  afterEach(() => {
    useChatStore.setState({ sending: false });
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps the send in progress when chat.send hits the RPC timeout', async () => {
    const rpcMock = vi.fn().mockRejectedValue(new Error('RPC timeout: chat.send'));
    useGatewayStore.setState({ rpc: rpcMock });
    useChatStore.setState({
      currentSessionKey: 'cron:test',
      currentDesktopSessionId: '',
      currentViewMode: 'cron',
      currentAgentId: 'main',
      desktopSessions: [],
      messages: [],
    });

    await useChatStore.getState().sendMessage('hello');

    expect(rpcMock).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'cron:test',
        message: 'hello',
        deliver: false,
      }),
      120_000,
    );

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
    });
    expect(useChatStore.getState().error).toContain('RPC timeout: chat.send');
  });

  it('clears a recoverable timeout error once chat deltas arrive', () => {
    useChatStore.setState({
      sending: true,
      error: 'RPC timeout: chat.send',
      currentSessionKey: 'cron:test',
      currentDesktopSessionId: '',
      currentViewMode: 'cron',
      currentAgentId: 'main',
      streamingText: '',
      streamSegments: [],
      toolMessages: [],
      pendingFinal: false,
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-timeout-recovery',
      message: {
        role: 'assistant',
        content: 'still working',
        timestamp: Date.now() / 1000,
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      sending: true,
      streamingText: 'still working',
    });
    expect(useChatStore.getState().error).toBeNull();
  });
});
