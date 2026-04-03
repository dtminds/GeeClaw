import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalHome = process.env.HOME;

const {
  mockExistsSync,
  mockRealpathSync,
  mockExecFile,
  mockSpawn,
  mockLoggerDebug,
  mockGetBundledPathEntries,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockRealpathSync: vi.fn<(path: string) => string>(),
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
  mockLoggerDebug: vi.fn(),
  mockGetBundledPathEntries: vi.fn(() => [] as string[]),
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

function normalizeWindowsTestPath(value: string | null): string | null {
  return value?.replace(/\//g, '\\') ?? null;
}

function createMockChild(output: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(output));
    child.emit('close', 0);
  });

  return child;
}

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    realpathSync: mockRealpathSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      realpathSync: mockRealpathSync,
    },
  };
});

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
  default: {
    execFile: mockExecFile,
    spawn: mockSpawn,
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: mockLoggerDebug,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@electron/utils/managed-bin', () => ({
  getBundledPathEntries: mockGetBundledPathEntries,
}));

describe('mcporter runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('darwin');
    process.env.PATH = '/usr/bin:/bin';
    process.env.HOME = '/Users/test';
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    process.env.PATH = originalPath;
    process.env.HOME = originalHome;
  });

  it('prepends GeeClaw runtime PATH when reading a managed mcporter version', async () => {
    const managedMcporterPath = '/Users/test/.geeclaw/npm-global/bin/mcporter';
    mockGetBundledPathEntries.mockReturnValue([
      '/Applications/GeeClaw.app/Contents/Resources/bin/bin',
      '/Applications/GeeClaw.app/Contents/Resources/bin',
    ]);
    const expectedRuntimePath = [
      '/Users/test/.geeclaw/npm-global/bin',
      '/Applications/GeeClaw.app/Contents/Resources/bin/bin',
      '/Applications/GeeClaw.app/Contents/Resources/bin',
      '/usr/bin',
      '/bin',
    ].join(':');

    mockExistsSync.mockImplementation((value: string) => value === managedMcporterPath);
    mockRealpathSync.mockImplementation((value: string) => value);
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(new Error('not found'), '', '');
    });
    mockSpawn.mockImplementation((command: string, args: string[], options?: { env?: Record<string, string | undefined> }) => {
      expect(command).toBe(managedMcporterPath);
      expect(args).toEqual(['--version']);
      expect(options?.env?.PATH).toBe(expectedRuntimePath);
      return createMockChild('mcporter 0.4.0');
    });

    const { getMcporterStatus } = await import('@electron/utils/mcporter-runtime');
    const status = await getMcporterStatus();

    expect(status.installed).toBe(true);
    expect(status.binaryPath).toBe(managedMcporterPath);
    expect(status.version).toBe('0.4.0');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('prefers the Windows cmd shim when where.exe also returns a non-executable mcporter file', async () => {
    setPlatform('win32');
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.USERPROFILE = 'C:\\Users\\test';
    process.env.PATH = 'C:\\Windows\\System32';
    delete process.env.Path;

    const mcporterShimPath = 'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\mcporter';
    const mcporterCmdPath = 'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\mcporter.cmd';

    mockExistsSync.mockImplementation((value: string) => {
      const normalized = normalizeWindowsTestPath(value)?.toLowerCase();
      return normalized === mcporterShimPath.toLowerCase() || normalized === mcporterCmdPath.toLowerCase();
    });
    mockRealpathSync.mockImplementation((value: string) => value);
    mockExecFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if (command === 'where.exe' && args[0] === 'mcporter') {
        callback(null, `${mcporterShimPath}\r\n${mcporterCmdPath}\r\n`, '');
        return;
      }

      callback(new Error(`Unexpected execFile call: ${command} ${args.join(' ')}`), '', '');
    });
    mockSpawn.mockImplementation((command: string, args: string[]) => {
      expect(normalizeWindowsTestPath(command)).toBe(mcporterCmdPath);
      expect(args).toEqual(['--version']);
      return createMockChild('mcporter 0.4.0');
    });

    const { getMcporterStatus } = await import('@electron/utils/mcporter-runtime');
    const status = await getMcporterStatus();

    expect(normalizeWindowsTestPath(status.binaryPath)).toBe(mcporterCmdPath);
    expect(status.version).toBe('0.4.0');
  });
});
