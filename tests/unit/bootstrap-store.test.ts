import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayState = {
  status: { state: 'stopped', error: null as string | null },
  init: vi.fn(async () => undefined),
  start: vi.fn(async () => {
    gatewayState.status = { state: 'running', error: null };
  }),
  stop: vi.fn(async () => undefined),
  rpc: vi.fn(async () => ({})),
};

const settingsState = {
  markSetupComplete: vi.fn(),
};

const sessionState = {
  status: 'authenticated' as const,
  account: {
    id: 'user-1',
    userStatus: 0,
  },
  init: vi.fn(async () => undefined),
  loginWithWechat: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
};

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => gatewayState,
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

vi.mock('@/stores/session', () => ({
  useSessionStore: {
    getState: () => sessionState,
  },
}));

describe('bootstrap store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    gatewayState.status = { state: 'stopped', error: null };
    gatewayState.init.mockResolvedValue(undefined);
    gatewayState.start.mockImplementation(async () => {
      gatewayState.status = { state: 'running', error: null };
    });
    gatewayState.rpc.mockResolvedValue({});
    settingsState.markSetupComplete.mockReset();
    sessionState.status = 'authenticated';
    sessionState.account = {
      id: 'user-1',
      userStatus: 0,
    };
    sessionState.init.mockResolvedValue(undefined);
  });

  it('continues startup when the authenticated account still has userStatus=0', async () => {
    const { useBootstrapStore } = await import('@/stores/bootstrap');

    await useBootstrapStore.getState().init();

    expect(useBootstrapStore.getState().phase).toBe('ready');
    expect(gatewayState.start).toHaveBeenCalledTimes(1);
    expect(gatewayState.rpc).toHaveBeenCalledWith(
      'chat.history',
      { sessionKey: 'agent:main:geeclaw_main', limit: 1 },
      2000,
    );
    expect(settingsState.markSetupComplete).toHaveBeenCalledTimes(1);
  });

  it('retries main session history warmup when gateway reports startup unavailable', async () => {
    const { useBootstrapStore } = await import('@/stores/bootstrap');
    gatewayState.rpc
      .mockRejectedValueOnce(new Error('chat.history unavailable during gateway startup'))
      .mockResolvedValueOnce({});

    await useBootstrapStore.getState().init();

    expect(useBootstrapStore.getState().phase).toBe('ready');
    expect(gatewayState.rpc).toHaveBeenCalledTimes(2);
    expect(settingsState.markSetupComplete).toHaveBeenCalledTimes(1);
  });

  it('retries main session history warmup when the history rpc times out', async () => {
    const { useBootstrapStore } = await import('@/stores/bootstrap');
    gatewayState.rpc
      .mockRejectedValueOnce(new Error('RPC timeout: chat.history'))
      .mockResolvedValueOnce({});

    await useBootstrapStore.getState().init();

    expect(useBootstrapStore.getState().phase).toBe('ready');
    expect(gatewayState.rpc).toHaveBeenCalledTimes(2);
    expect(settingsState.markSetupComplete).toHaveBeenCalledTimes(1);
  });

  it('shows the gateway service warmup phase while preloading history', async () => {
    const { useBootstrapStore } = await import('@/stores/bootstrap');
    gatewayState.rpc.mockImplementationOnce(async () => {
      expect(useBootstrapStore.getState().phase).toBe('warming_gateway_services');
      return { ok: true };
    });

    await useBootstrapStore.getState().init();

    expect(useBootstrapStore.getState().phase).toBe('ready');
  });
});
