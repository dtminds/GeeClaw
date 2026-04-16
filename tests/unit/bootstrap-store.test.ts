import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayState = {
  status: { state: 'stopped', error: null as string | null },
  init: vi.fn(async () => undefined),
  start: vi.fn(async () => {
    gatewayState.status = { state: 'running', error: null };
  }),
  stop: vi.fn(async () => undefined),
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
    expect(settingsState.markSetupComplete).toHaveBeenCalledTimes(1);
  });
});
