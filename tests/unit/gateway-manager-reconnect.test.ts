import { beforeEach, describe, expect, it, vi } from 'vitest';

const runGatewayStartupSequenceMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('@electron/gateway/startup-orchestrator', () => ({
  runGatewayStartupSequence: runGatewayStartupSequenceMock,
}));

vi.mock('@electron/utils/device-identity', () => ({
  loadOrCreateDeviceIdentity: vi.fn(async () => ({
    deviceId: 'device-id',
    publicKeyPem: 'public-key',
    secretKeyPem: 'secret-key',
  })),
}));

vi.mock('@electron/gateway/supervisor', async () => {
  const actual = await vi.importActual<object>('@electron/gateway/supervisor');
  return {
    ...actual,
    warmupManagedPythonReadiness: vi.fn(),
  };
});

describe('GatewayManager auto reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves reconnect attempt count when an auto-reconnect start begins', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (
      manager as unknown as {
        reconnectAttempts: number;
        isAutoReconnectStart?: boolean;
      }
    ).reconnectAttempts = 2;
    (
      manager as unknown as {
        reconnectAttempts: number;
        isAutoReconnectStart?: boolean;
      }
    ).isAutoReconnectStart = true;

    await manager.start();

    expect(manager.getStatus()).toMatchObject({
      state: 'starting',
      port: 28788,
      reconnectAttempts: 2,
    });
  });
});
