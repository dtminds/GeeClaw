import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockSpawn,
  mockExistsSync,
  mockPruneRuntime,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExistsSync: vi.fn(() => false),
  mockPruneRuntime: vi.fn(() => Promise.resolve(0)),
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

function createSuccessfulChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout?: EventEmitter;
    stderr?: EventEmitter;
  };

  setTimeout(() => {
    child.emit('exit', 0);
  }, 0);

  return child;
}

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: mockSpawn,
    default: {
      ...actual,
      spawn: mockSpawn,
    },
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
  };
});

vi.mock('../../openclaw-runtime/prune-runtime.mjs', () => ({
  pruneRuntime: mockPruneRuntime,
}));

describe('openclaw-runtime install script', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('win32');
    mockExistsSync.mockReturnValue(false);
    mockSpawn.mockImplementation(() => createSuccessfulChildProcess());
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('forces shell execution for npm.cmd on Windows', async () => {
    const { installRuntime } = await import('../../openclaw-runtime/install-runtime.mjs');

    await installRuntime();

    expect(mockSpawn).toHaveBeenCalledWith(
      'npm.cmd',
      ['install', '--omit=peer', '--no-audit', '--no-fund', '--prefer-offline'],
      expect.objectContaining({
        shell: true,
      }),
    );
    expect(mockPruneRuntime).toHaveBeenCalledTimes(1);
  });

  it('still prunes the runtime after npm ci falls back to npm install', async () => {
    const { installRuntime } = await import('../../openclaw-runtime/install-runtime.mjs');

    mockExistsSync.mockReturnValue(true);
    mockSpawn
      .mockImplementationOnce(() => {
        const child = new EventEmitter() as EventEmitter;
        setTimeout(() => {
          child.emit('exit', 1);
        }, 0);
        return child;
      })
      .mockImplementationOnce(() => createSuccessfulChildProcess());

    await installRuntime();

    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      'npm.cmd',
      ['ci', '--omit=peer', '--no-audit', '--no-fund'],
      expect.objectContaining({
        shell: true,
      }),
    );
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      'npm.cmd',
      ['install', '--omit=peer', '--no-audit', '--no-fund', '--prefer-offline'],
      expect.objectContaining({
        shell: true,
      }),
    );
    expect(mockPruneRuntime).toHaveBeenCalledTimes(1);
  });
});
