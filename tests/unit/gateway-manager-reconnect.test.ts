import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runGatewayStartupSequenceMock = vi.hoisted(() => vi.fn(async () => {}));
const findExistingGatewayProcessMock = vi.hoisted(() => vi.fn(async () => null));
const reconcileGatewayRuntimeForEmbeddedModeMock = vi.hoisted(() => vi.fn(async () => {}));
const runOpenClawDoctorRepairMock = vi.hoisted(() => vi.fn(async () => false));
const getSettingMock = vi.hoisted(() => vi.fn(async () => 'test-gateway-token'));
const prepareGatewayLaunchContextMock = vi.hoisted(() => vi.fn(async () => ({})));
const waitForGatewayReadyMock = vi.hoisted(() => vi.fn(async () => {}));
const connectGatewaySocketMock = vi.hoisted(() => vi.fn());
const launchGatewayProcessMock = vi.hoisted(() => vi.fn());

class MockGatewayChild extends EventEmitter {
  pid = 99612;
  stderr = new EventEmitter();
  kill = vi.fn();
}

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

vi.mock('@electron/gateway/config-sync', () => ({
  prepareGatewayLaunchContext: prepareGatewayLaunchContextMock,
}));

vi.mock('@electron/gateway/ws-client', () => ({
  waitForGatewayReady: waitForGatewayReadyMock,
  connectGatewaySocket: connectGatewaySocketMock,
}));

vi.mock('@electron/gateway/process-launcher', () => ({
  launchGatewayProcess: launchGatewayProcessMock,
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: getSettingMock,
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
    findExistingGatewayProcess: findExistingGatewayProcessMock,
    reconcileGatewayRuntimeForEmbeddedMode: reconcileGatewayRuntimeForEmbeddedModeMock,
    runOpenClawDoctorRepair: runOpenClawDoctorRepairMock,
    warmupManagedPythonReadiness: vi.fn(),
    unloadLaunchctlGatewayService: vi.fn(async () => {}),
  };
});

describe('GatewayManager auto reconnect', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(reconcileGatewayRuntimeForEmbeddedModeMock).toHaveBeenCalledWith(28788);
  });

  it('reconciles embedded mode again after doctor repair succeeds', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    await manager.start();

    const startupHooks = runGatewayStartupSequenceMock.mock.calls[0]?.[0];
    expect(startupHooks).toBeDefined();

    reconcileGatewayRuntimeForEmbeddedModeMock.mockClear();
    runOpenClawDoctorRepairMock.mockResolvedValueOnce(true);

    await expect(startupHooks.runDoctorRepair()).resolves.toBe(true);

    expect(reconcileGatewayRuntimeForEmbeddedModeMock).toHaveBeenCalledWith(28788);
  });

  it('stays connected when the spawned child exits after the websocket is already running', async () => {
    vi.doUnmock('@electron/gateway/startup-orchestrator');

    const ws = {
      readyState: 1,
      on: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      send: vi.fn(),
    };

    let exitedChild: MockGatewayChild | null = null;
    let emitExit: ((code: number | null) => void) | null = null;

    connectGatewaySocketMock.mockImplementation(async (options) => {
      options.onHandshakeComplete(ws as never);
      return ws as never;
    });

    launchGatewayProcessMock.mockImplementation(async (options) => {
      const child = new MockGatewayChild();
      exitedChild = child;
      emitExit = (code: number | null) => {
        options.onExit(child as never, code);
      };
      options.onSpawn(child.pid);
      return {
        child: child as never,
        lastSpawnSummary: 'mock-spawn',
      };
    });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    await manager.start();

    expect(getSettingMock).toHaveBeenCalledWith('gatewayToken');
    expect(connectGatewaySocketMock).toHaveBeenCalledWith(expect.objectContaining({
      token: 'test-gateway-token',
    }));
    expect(connectGatewaySocketMock.mock.calls[0]?.[0]).not.toHaveProperty('getToken');

    expect(manager.getStatus()).toMatchObject({
      state: 'running',
      port: 28788,
      pid: 99612,
    });

    expect(exitedChild).not.toBeNull();
    emitExit?.(0);

    expect(manager.getStatus()).toMatchObject({
      state: 'running',
      port: 28788,
      pid: undefined,
    });
    expect((manager as unknown as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer).toBeNull();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });
});
