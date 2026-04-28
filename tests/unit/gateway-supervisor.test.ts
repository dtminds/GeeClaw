import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockExec,
  mockExecFile,
  mockCreateServer,
  mockFetch,
  mockWebSocketState,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExecFile: vi.fn(),
  mockCreateServer: vi.fn(),
  mockFetch: vi.fn(),
  mockWebSocketState: { mode: 'error' as 'open' | 'error' },
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
  },
  utilityProcess: {},
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  execFile: mockExecFile,
  execSync: vi.fn(),
  spawn: vi.fn(),
  default: {
    exec: mockExec,
    execFile: mockExecFile,
    execSync: vi.fn(),
    spawn: vi.fn(),
  },
}));

vi.mock('net', () => ({
  createServer: mockCreateServer,
}));

vi.mock('ws', () => ({
  default: class MockWebSocket extends EventEmitter {
    terminate = vi.fn();

    constructor(_url: string) {
      super();
      queueMicrotask(() => {
        if (mockWebSocketState.mode === 'open') {
          this.emit('open');
        } else {
          this.emit('error', new Error('mock websocket closed'));
        }
      });
    }
  },
}));

class MockUtilityChild extends EventEmitter {
  pid?: number;
  kill = vi.fn();

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }
}

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('gateway supervisor process cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockWebSocketState.mode = 'error';
    mockFetch.mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', mockFetch);

    mockExec.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        callback(null, '');
      }
      return {} as never;
    });

    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        callback(null, '');
      }
      return {} as never;
    });

    mockCreateServer.mockImplementation(() => {
      const handlers = new Map<string, (...args: unknown[]) => void>();
      return {
        once(event: string, callback: (...args: unknown[]) => void) {
          handlers.set(event, callback);
          return this;
        },
        listen() {
          queueMicrotask(() => handlers.get('listening')?.());
          return this;
        },
        close(callback?: () => void) {
          callback?.();
        },
      };
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    vi.unstubAllGlobals();
  });

  it('uses taskkill tree strategy for owned process on Windows', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    await vi.waitFor(() => {
      expect(mockExec).toHaveBeenCalledWith(
        'taskkill /F /PID 4321 /T',
        expect.objectContaining({ timeout: 5000, windowsHide: true }),
        expect.any(Function),
      );
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('uses direct child.kill for owned process on non-Windows', async () => {
    setPlatform('linux');
    const child = new MockUtilityChild(9876);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    await vi.waitFor(() => {
      expect(child.kill).toHaveBeenCalledTimes(1);
    });
  });

  it('terminates Unix child descendants before considering owned process stopped', async () => {
    setPlatform('darwin');
    const child = new MockUtilityChild(9876);
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);
    const callOrder: string[] = [];

    mockExecFile.mockImplementation((...args: unknown[]) => {
      const [cmd, argv, options, callback] = args as [string, string[], object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'ps' && argv.join(' ') === '-axo pid=,ppid=') {
        callOrder.push('ps-tree');
        callback(null, '111 9876\n222 111\n333 222\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });
    child.kill.mockImplementation(() => {
      callOrder.push('child-kill');
      return true;
    });

    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    await vi.waitFor(() => {
      expect(child.kill).toHaveBeenCalledTimes(1);
    });
    expect(callOrder.indexOf('ps-tree')).toBeLessThan(callOrder.indexOf('child-kill'));
    await vi.waitFor(() => {
      expect(processKillSpy).toHaveBeenCalledWith(333, 'SIGTERM');
      expect(processKillSpy).toHaveBeenCalledWith(222, 'SIGTERM');
      expect(processKillSpy).toHaveBeenCalledWith(111, 'SIGTERM');
    });
  });

  it('waits for Unix descendant signaling before resolving stop', async () => {
    setPlatform('darwin');
    const child = new MockUtilityChild(9876);
    let releaseProcessTree: ((err: Error | null, stdout: string) => void) | null = null;
    let stopResolved = false;

    mockExecFile.mockImplementation((...args: unknown[]) => {
      const [cmd, argv, options, callback] = args as [string, string[], object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'ps' && argv.join(' ') === '-axo pid=,ppid=') {
        releaseProcessTree = callback;
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });

    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess)
      .then(() => {
        stopResolved = true;
      });

    child.emit('exit', 0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopResolved).toBe(false);
    releaseProcessTree?.(null, '111 9876\n');

    await stopPromise;
    expect(stopResolved).toBe(true);
  });

  it('waits for port release after orphan cleanup on Windows', async () => {
    setPlatform('win32');
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((...args: unknown[]) => {
      const [cmd, options, callback] = args as [string, object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd.includes('netstat -ano')) {
        callback(null, '  TCP    127.0.0.1:28788    0.0.0.0:0    LISTENING    4321\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });

    const result = await findExistingGatewayProcess({ port: 28788 });
    expect(result).toBeNull();

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('taskkill /F /PID 4321 /T'),
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
      expect.any(Function),
    );
    expect(mockCreateServer).toHaveBeenCalled();
  });

  it('reconciles managed gateway listeners back to embedded mode', async () => {
    setPlatform('darwin');
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);

    mockExec.mockImplementation((...args: unknown[]) => {
      const [cmd, options, callback] = args as [string, object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'lsof -i :28788 -sTCP:LISTEN -t') {
        callback(null, '4321\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const [cmd, argv, options, callback] = args as [string, string[], object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'ps' && argv.join(' ') === '-o command= -p 4321') {
        callback(null, '/usr/bin/node /tmp/openclaw.mjs --profile geeclaw gateway\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });

    const { reconcileGatewayRuntimeForEmbeddedMode } = await import('@electron/gateway/supervisor');

    await expect(reconcileGatewayRuntimeForEmbeddedMode(28788)).resolves.toBeUndefined();

    expect(processKillSpy).toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(mockCreateServer).toHaveBeenCalled();
  });

  it('unloads the managed geeclaw launchctl service label during embedded reconciliation', async () => {
    setPlatform('darwin');
    const uid = process.getuid?.();
    if (uid === undefined) {
      return;
    }

    mockExec.mockImplementation((...args: unknown[]) => {
      const [cmd, options, callback] = args as [string, object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === `launchctl print gui/${uid}/ai.openclaw.geeclaw`) {
        callback(null, 'service loaded');
        return {} as never;
      }
      callback(new Error('not loaded'), '');
      return {} as never;
    });

    const { unloadLaunchctlGatewayService } = await import('@electron/gateway/supervisor');

    await expect(unloadLaunchctlGatewayService()).resolves.toBeUndefined();

    expect(mockExec).toHaveBeenCalledWith(
      `launchctl bootout gui/${uid}/ai.openclaw.geeclaw`,
      expect.objectContaining({ timeout: 10000 }),
      expect.any(Function),
    );
    expect(mockExec).not.toHaveBeenCalledWith(
      `launchctl bootout gui/${uid}/ai.openclaw.gateway`,
      expect.anything(),
      expect.any(Function),
    );
  });

  it('reclaims only managed geeclaw-profile listeners before startup fails', async () => {
    setPlatform('darwin');
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);

    mockExec.mockImplementation((...args: unknown[]) => {
      const [cmd, options, callback] = args as [string, object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'lsof -i :28788 -sTCP:LISTEN -t') {
        callback(null, '4321\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const [cmd, argv, options, callback] = args as [string, string[], object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'ps' && argv.join(' ') === '-o command= -p 4321') {
        callback(null, '/usr/bin/node /tmp/openclaw.mjs --profile geeclaw gateway\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });

    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    const result = await findExistingGatewayProcess({
      port: 28788,
      terminateForeignProcess: false,
      rejectForeignProcess: true,
      reclaimLikelyGatewayResidue: true,
    });

    expect(result).toBeNull();
    expect(processKillSpy).toHaveBeenCalledWith(4321, 'SIGTERM');
  });

  it('does not reclaim a system-wide openclaw listener when it is not the geeclaw managed profile', async () => {
    setPlatform('darwin');
    mockFetch.mockResolvedValue({ ok: true });
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);

    mockExec.mockImplementation((...args: unknown[]) => {
      const [cmd, options, callback] = args as [string, object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'lsof -i :28788 -sTCP:LISTEN -t') {
        callback(null, '4321\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const [cmd, argv, options, callback] = args as [string, string[], object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'ps' && argv.join(' ') === '-o command= -p 4321') {
        callback(null, '/usr/bin/node /tmp/openclaw.mjs gateway\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });

    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    await expect(findExistingGatewayProcess({
      port: 28788,
      terminateForeignProcess: false,
      rejectForeignProcess: true,
      reclaimLikelyGatewayResidue: true,
    })).rejects.toThrow('already in use by another OpenClaw-compatible process');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:28788/healthz',
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(processKillSpy).not.toHaveBeenCalledWith(4321, 'SIGTERM');
  });

  it('ignores non-numeric listener ids when checking process command lines', async () => {
    setPlatform('darwin');
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);

    mockExec.mockImplementation((...args: unknown[]) => {
      const [cmd, options, callback] = args as [string, object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'lsof -i :28788 -sTCP:LISTEN -t') {
        callback(null, '4321;rm -rf /\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });

    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    await expect(findExistingGatewayProcess({
      port: 28788,
      terminateForeignProcess: false,
      rejectForeignProcess: true,
      reclaimLikelyGatewayResidue: true,
    })).rejects.toThrow('already in use by another process');

    expect(mockExecFile).not.toHaveBeenCalledWith(
      'ps',
      expect.arrayContaining(['4321;rm -rf /']),
      expect.anything(),
      expect.any(Function),
    );
    expect(processKillSpy).not.toHaveBeenCalled();
  });

  it('does not reclaim an active external OpenClaw-compatible gateway', async () => {
    setPlatform('darwin');
    mockFetch.mockResolvedValue({ ok: true });
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);

    mockExec.mockImplementation((...args: unknown[]) => {
      const [cmd, options, callback] = args as [string, object, (err: Error | null, stdout: string) => void];
      void options;
      if (cmd === 'lsof -i :28788 -sTCP:LISTEN -t') {
        callback(null, '4321\n');
        return {} as never;
      }
      callback(null, '');
      return {} as never;
    });

    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    await expect(findExistingGatewayProcess({
      port: 28788,
      terminateForeignProcess: false,
      rejectForeignProcess: true,
      reclaimLikelyGatewayResidue: true,
    })).rejects.toThrow('already in use by another OpenClaw-compatible process');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:28788/healthz',
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(processKillSpy).not.toHaveBeenCalledWith(4321, 'SIGTERM');
  });
});
