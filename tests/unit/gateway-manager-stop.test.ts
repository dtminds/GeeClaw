import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const terminateOwnedGatewayProcessMock = vi.hoisted(() => vi.fn(async () => {}));
const terminateGatewayListenersOnPortMock = vi.hoisted(() => vi.fn(async () => [] as string[]));
const getGatewayListenerProcessIdsMock = vi.hoisted(() => vi.fn(async () => [] as string[]));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
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
    terminateOwnedGatewayProcess: terminateOwnedGatewayProcessMock,
    terminateGatewayListenersOnPort: terminateGatewayListenersOnPortMock,
    getGatewayListenerProcessIds: getGatewayListenerProcessIdsMock,
    findExistingGatewayProcess: vi.fn(async () => null),
    runOpenClawDoctorRepair: vi.fn(async () => false),
    unloadLaunchctlGatewayService: vi.fn(async () => {}),
    waitForPortFree: vi.fn(async () => {}),
    warmupManagedPythonReadiness: vi.fn(),
  };
});

class MockGatewayChild extends EventEmitter {
  pid = 80013;
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('GatewayManager stop cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('cleans up lingering listeners during app quit when the manager owns the gateway process', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const child = new MockGatewayChild();

    (
      manager as unknown as {
        process: MockGatewayChild | null;
        ownsProcess: boolean;
      }
    ).process = child;
    (
      manager as unknown as {
        process: MockGatewayChild | null;
        ownsProcess: boolean;
      }
    ).ownsProcess = true;

    await manager.stop({ shutdownExternal: false });

    expect(terminateOwnedGatewayProcessMock).toHaveBeenCalledWith(child);
    expect(terminateGatewayListenersOnPortMock).toHaveBeenCalledWith(28788);
    expect(getGatewayListenerProcessIdsMock).not.toHaveBeenCalled();
  });
});
