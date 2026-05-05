import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

describe('GatewayManager heartbeat recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
  });

  it('logs warning but does not terminate the socket after consecutive heartbeat misses', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 28788,
    };

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(120_000);

    expect(ws.ping).toHaveBeenCalledTimes(3);
    expect(ws.terminate).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('does not terminate when heartbeat is recovered by incoming messages', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 28788,
    };

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage('alive');

    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);

    expect(ws.terminate).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('reports transport health and records OpenClaw health/status capability probes', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (manager as unknown as { ws: { readyState: number } }).ws = { readyState: 1 };
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 28788,
      connectedAt: Date.now() - 5000,
      gatewayReady: true,
    };
    const rpc = vi.spyOn(manager, 'rpc').mockResolvedValue({ ok: true, uptimeMs: 5000 });

    await expect(manager.checkHealth()).resolves.toMatchObject({ ok: true, uptime: 5 });

    expect(rpc).toHaveBeenCalledWith('health', { probe: false }, 3000);
    expect(rpc).toHaveBeenCalledWith('status', {}, 3000);
    expect(manager.getCapabilitySnapshot().openclawHealth.state).toBe('healthy');
    expect(manager.getCapabilitySnapshot().openclawStatus.state).toBe('healthy');
  });

  it('uses system-presence as a core readiness probe before optional capability probes', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (manager as unknown as { ws: { readyState: number } }).ws = { readyState: 1 };
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 28788,
      connectedAt: Date.now() - 5000,
      gatewayReady: false,
    };
    const rpc = vi.spyOn(manager, 'rpc').mockResolvedValue({ present: true });

    await expect(manager.checkHealth()).resolves.toMatchObject({ ok: true, uptime: 5 });

    expect(rpc).toHaveBeenCalledWith('system-presence', {}, 3000);
    expect(rpc).not.toHaveBeenCalledWith('health', expect.anything(), expect.any(Number));
    expect(manager.getCapabilitySnapshot().core.rpcRouter).toBe('ready');
  });

  it('treats slow OpenClaw health/status probes as capability degradation, not Gateway failure', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (manager as unknown as { ws: { readyState: number } }).ws = { readyState: 1 };
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 28788,
      connectedAt: Date.now() - 5000,
      gatewayReady: true,
    };
    vi.spyOn(manager, 'rpc').mockRejectedValue(new Error('RPC timeout: health'));

    await expect(manager.checkHealth()).resolves.toMatchObject({ ok: true, uptime: 5 });
    expect(manager.getCapabilitySnapshot().openclawHealth).toMatchObject({
      state: 'degraded',
      error: 'RPC timeout: health',
    });
    expect(manager.getCapabilitySnapshot().openclawStatus).toMatchObject({
      state: 'degraded',
      error: 'RPC timeout: health',
    });
  });
});
