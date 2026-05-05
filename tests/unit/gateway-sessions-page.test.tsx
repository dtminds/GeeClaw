import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useGatewayStore } from '@/stores/gateway';

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => ({
      title: 'Gateway Sessions',
      gatewayRequired: 'Gateway required',
      emptyDescription: 'No sessions',
      sessionCount: `${options?.count ?? 0} sessions`,
      refresh: 'Refresh',
      empty: 'Empty',
      previewDescription: 'Select a session',
      historyError: 'History error',
      historyEmpty: 'No messages',
    }[key] || key),
  }),
}));

vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: () => <div data-testid="chat-message" />,
}));

describe('GatewaySessions readiness gating', () => {
  const initialGatewayState = useGatewayStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useGatewayStore.setState(initialGatewayState, true);
  });

  it('does not issue session RPCs while the gateway process is running but not ready', async () => {
    const rpc = vi.fn().mockResolvedValue({ sessions: [] });
    useGatewayStore.setState({
      ...initialGatewayState,
      status: {
        ...initialGatewayState.status,
        state: 'running',
        gatewayReady: false,
      },
      rpc,
    });

    const { GatewaySessions } = await import('@/pages/GatewaySessions');
    await act(async () => {
      render(<GatewaySessions />);
    });

    expect(rpc).not.toHaveBeenCalled();
  });
});
