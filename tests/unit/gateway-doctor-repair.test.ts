import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forkMock = vi.fn();

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
  utilityProcess: {
    fork: forkMock,
  },
}));

vi.mock('@electron/utils/openclaw-runtime', () => ({
  getConfiguredOpenClawRuntime: vi.fn(async () => ({
    source: 'bundled',
    packageExists: true,
    isBuilt: true,
    dir: '/opt/openclaw',
    entryPath: '/opt/openclaw/openclaw.mjs',
    commandPath: '/opt/openclaw/openclaw.mjs',
    displayName: 'Bundled OpenClaw',
  })),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => '/Users/test/.openclaw-geeclaw'),
}));

vi.mock('@electron/utils/managed-bin', () => ({
  getBundledNodePath: vi.fn(() => null),
}));

vi.mock('@electron/utils/runtime-path', () => ({
  getGeeClawRuntimePath: vi.fn(() => '/opt/geeclaw/bin:/usr/bin'),
  getGeeClawRuntimePathEntries: vi.fn(() => ['/opt/geeclaw/bin']),
}));

vi.mock('@electron/utils/env-path', () => ({
  setPathEnvValue: vi.fn((env: Record<string, string | undefined>, value: string) => ({
    ...env,
    PATH: value,
  })),
}));

vi.mock('@electron/utils/uv-env', () => ({
  getUvMirrorEnv: vi.fn(async () => ({})),
}));

vi.mock('@electron/utils/config', () => ({
  PORTS: {
    OPENCLAW_GATEWAY: 28788,
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSyncMock = vi.fn(() => true);
  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual,
      existsSync: existsSyncMock,
    },
    existsSync: existsSyncMock,
  };
});

class MockUtilityChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('runOpenClawDoctorRepair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs doctor repair without GeeClaw-specific bundled-plugin overrides', async () => {
    forkMock.mockImplementation((_entryPath: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = new MockUtilityChild();
      queueMicrotask(() => child.emit('exit', 0));
      return Object.assign(child, { options });
    });

    const { runOpenClawDoctorRepair } = await import('@electron/gateway/supervisor');

    await expect(runOpenClawDoctorRepair()).resolves.toBe(true);

    expect(forkMock).toHaveBeenCalledWith(
      '/opt/openclaw/openclaw.mjs',
      ['--profile', 'geeclaw', 'doctor', '--fix', '--yes', '--non-interactive'],
      expect.objectContaining({
        cwd: '/opt/openclaw',
        stdio: 'pipe',
        env: expect.objectContaining({
          OPENCLAW_STATE_DIR: '/Users/test/.openclaw-geeclaw',
          OPENCLAW_CONFIG_PATH: '/Users/test/.openclaw-geeclaw/openclaw.json',
        }),
      }),
    );

    const forkOptions = forkMock.mock.calls[0]?.[2];
    expect(forkOptions?.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS).toBeUndefined();
  });

  it('does not log success after timing out and later receiving exit 0', async () => {
    vi.useFakeTimers();

    let child: MockUtilityChild | null = null;
    forkMock.mockImplementation(() => {
      child = new MockUtilityChild();
      return child;
    });

    const { logger } = await import('@electron/utils/logger');
    const { runOpenClawDoctorRepair } = await import('@electron/gateway/supervisor');

    const repairPromise = runOpenClawDoctorRepair();
    await vi.advanceTimersByTimeAsync(120000);
    await expect(repairPromise).resolves.toBe(false);

    child?.emit('exit', 0);

    expect(logger.error).toHaveBeenCalledWith('OpenClaw doctor repair timed out after 120000ms');
    expect(logger.info).not.toHaveBeenCalledWith('OpenClaw doctor repair completed successfully');

    vi.useRealTimers();
  });
});
