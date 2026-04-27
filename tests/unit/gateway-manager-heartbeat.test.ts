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

  it('checks semantic gateway health through the registered health rpc', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (manager as unknown as { ws: { readyState: number } }).ws = { readyState: 1 };
    (manager as unknown as { status: { state: string; port: number; connectedAt: number } }).status = {
      state: 'running',
      port: 28788,
      connectedAt: Date.now() - 5000,
    };
    const rpc = vi.spyOn(manager, 'rpc').mockResolvedValue({ uptimeMs: 5000 });

    await expect(manager.checkHealth()).resolves.toMatchObject({ ok: true, uptime: 5 });

    expect(rpc).toHaveBeenCalledWith('health', { probe: false }, 5000);
  });

  it('returns unhealthy when the registered health rpc fails', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (manager as unknown as { ws: { readyState: number } }).ws = { readyState: 1 };
    (manager as unknown as { status: { state: string; port: number; connectedAt: number } }).status = {
      state: 'running',
      port: 28788,
      connectedAt: Date.now() - 5000,
    };
    vi.spyOn(manager, 'rpc').mockRejectedValue(new Error('health unavailable'));

    await expect(manager.checkHealth()).resolves.toMatchObject({
      ok: false,
      error: 'Error: health unavailable',
    });
  });
});
