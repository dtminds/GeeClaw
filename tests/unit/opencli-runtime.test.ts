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
  mockLoggerInfo,
  mockGetBundledPathEntries,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockRealpathSync: vi.fn<(path: string) => string>(),
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
  mockLoggerInfo: vi.fn(),
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
    info: mockLoggerInfo,
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@electron/utils/managed-bin', () => ({
  getBundledPathEntries: mockGetBundledPathEntries,
}));

describe('opencli runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('darwin');
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin';
    process.env.HOME = '/Users/test';
    mockExistsSync.mockImplementation((value: string) => value === '/usr/local/bin/opencli');
    mockRealpathSync.mockImplementation((value: string) => value);
    mockExecFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if (command === 'which' && args[0] === '-a') {
        callback(null, '/usr/local/bin/opencli\n', '');
        return;
      }

      callback(new Error(`Unexpected execFile call: ${command} ${args.join(' ')}`), '', '');
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    process.env.PATH = originalPath;
    process.env.HOME = originalHome;
  });

  it('parses a healthy doctor report', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[OK] Extension: connected
[OK] Connectivity: connected in 1.2s

Everything looks good!
`);

    expect(parsed).toEqual({
      ok: true,
      daemonRunning: true,
      extensionConnected: true,
      connectivityOk: true,
      issues: [],
    });
  });

  it('treats skipped live checks as non-failing when everything else is healthy', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[OK] Extension: connected
[SKIP] Connectivity: skipped (--no-live)

Everything looks good!
`);

    expect(parsed).toEqual({
      ok: true,
      daemonRunning: true,
      extensionConnected: true,
      connectivityOk: null,
      issues: [],
    });
  });

  it('collects reported issues when the extension is not connected', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[MISSING] Extension: not connected
[FAIL] Connectivity: failed (connection refused)

Issues:
  • Daemon is running but the Chrome extension is not connected.
  • Please install the opencli Browser Bridge extension:
    1. Download from GitHub Releases
    2. Open chrome://extensions/ -> Enable Developer Mode
    3. Click "Load unpacked" -> select the extension folder
`);

    expect(parsed.ok).toBe(false);
    expect(parsed.daemonRunning).toBe(true);
    expect(parsed.extensionConnected).toBe(false);
    expect(parsed.connectivityOk).toBe(false);
    expect(parsed.issues).toHaveLength(2);
  });

  it('skips warmup and returns a missing status when system opencli is not on PATH', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(new Error('not found'), '', '');
    });

    const { getOpenCliStatus, warmupOpenCliDoctor } = await import('@electron/utils/opencli-runtime');

    const warmup = await warmupOpenCliDoctor();
    const status = await getOpenCliStatus();

    expect(warmup).toBeNull();
    expect(status).toMatchObject({
      binaryExists: false,
      binaryPath: null,
      version: null,
      command: null,
      doctor: null,
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('falls back to the GeeClaw managed npm prefix when GUI PATH does not include opencli', async () => {
    process.env.PATH = '/usr/bin:/bin';
    const managedOpenCliPath = `${process.env.HOME || '/Users/test'}/.geeclaw/npm-global/bin/opencli`;
    mockGetBundledPathEntries.mockReturnValue([
      '/Applications/GeeClaw.app/Contents/Resources/bin/bin',
      '/Applications/GeeClaw.app/Contents/Resources/bin',
    ]);
    const expectedRuntimePath = [
      `${process.env.HOME || '/Users/test'}/.geeclaw/npm-global/bin`,
      '/Applications/GeeClaw.app/Contents/Resources/bin/bin',
      '/Applications/GeeClaw.app/Contents/Resources/bin',
      '/usr/bin',
      '/bin',
    ].join(':');

    mockExistsSync.mockImplementation((value: string) => value === managedOpenCliPath);
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(new Error('not found'), '', '');
    });
    mockSpawn.mockImplementation((command: string, args: string[], options?: { env?: Record<string, string | undefined> }) => {
      expect(options?.env?.PATH).toBe(expectedRuntimePath);
      if (args[0] === '--version') {
        expect(command).toBe(managedOpenCliPath);
        return createMockChild('opencli 1.5.5');
      }

      expect(command).toBe(managedOpenCliPath);
      expect(args).toEqual(['doctor', '--no-live']);
      return createMockChild([
        'opencli v1.5.5 doctor',
        '',
        '[OK] Daemon: running on port 19825',
        '[OK] Extension: connected',
        '[SKIP] Connectivity: skipped (--no-live)',
        '',
        'Everything looks good!',
      ].join('\n'));
    });

    const { getOpenCliStatus } = await import('@electron/utils/opencli-runtime');
    const status = await getOpenCliStatus();

    expect(status.binaryExists).toBe(true);
    expect(status.binaryPath).toBe(managedOpenCliPath);
    expect(status.version).toBe('1.5.5');
    expect(status.doctor?.ok).toBe(true);
  });

  it('prefers the Windows cmd shim when where.exe also returns a non-executable opencli file', async () => {
    setPlatform('win32');
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.USERPROFILE = 'C:\\Users\\test';
    process.env.PATH = 'C:\\Windows\\System32';
    delete process.env.Path;

    const openCliShimPath = 'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\opencli';
    const openCliCmdPath = 'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global\\opencli.cmd';

    mockExistsSync.mockImplementation((value: string) => {
      const normalized = normalizeWindowsTestPath(value)?.toLowerCase();
      return normalized === openCliShimPath.toLowerCase() || normalized === openCliCmdPath.toLowerCase();
    });
    mockRealpathSync.mockImplementation((value: string) => value);
    mockExecFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if (command === 'where.exe' && args[0] === 'opencli') {
        callback(null, `${openCliShimPath}\r\n${openCliCmdPath}\r\n`, '');
        return;
      }

      callback(new Error(`Unexpected execFile call: ${command} ${args.join(' ')}`), '', '');
    });
    mockSpawn.mockImplementation((command: string, args: string[]) => {
      expect(normalizeWindowsTestPath(command)).toBe(openCliCmdPath);
      if (args[0] === '--version') {
        return createMockChild('opencli 1.5.5');
      }

      expect(args).toEqual(['doctor', '--no-live']);
      return createMockChild([
        'opencli v1.5.5 doctor',
        '',
        '[OK] Daemon: running on port 19825',
        '[OK] Extension: connected',
        '[SKIP] Connectivity: skipped (--no-live)',
        '',
        'Everything looks good!',
      ].join('\n'));
    });

    const { getOpenCliStatus } = await import('@electron/utils/opencli-runtime');
    const status = await getOpenCliStatus();

    expect(normalizeWindowsTestPath(status.binaryPath)).toBe(openCliCmdPath);
    expect(status.version).toBe('1.5.5');
    expect(status.doctor?.ok).toBe(true);
  });

  it('runs doctor against the detected system opencli command', async () => {
    mockSpawn.mockImplementation((command: string, args: string[]) => {
      if (args[0] === '--version') {
        expect(command).toBe('/usr/local/bin/opencli');
        return createMockChild('opencli 1.5.5');
      }

      expect(command).toBe('/usr/local/bin/opencli');
      expect(args).toEqual(['doctor', '--no-live']);
      return createMockChild([
        'opencli v1.5.5 doctor',
        '',
        '[OK] Daemon: running on port 19825',
        '[OK] Extension: connected',
        '[SKIP] Connectivity: skipped (--no-live)',
        '',
        'Everything looks good!',
      ].join('\n'));
    });

    const { getOpenCliStatus } = await import('@electron/utils/opencli-runtime');
    const status = await getOpenCliStatus();

    expect(status.binaryExists).toBe(true);
    expect(status.binaryPath).toBe('/usr/local/bin/opencli');
    expect(status.version).toBe('1.5.5');
    expect(status.command).toBe('/usr/local/bin/opencli');
    expect(status.doctor?.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('deduplicates doctor warmup and status fetch when they overlap', async () => {
    mockSpawn.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === '--version') {
        return createMockChild('opencli 1.5.5');
      }

      return createMockChild([
        'opencli v1.5.5 doctor',
        '',
        '[OK] Daemon: running on port 19825',
        '[OK] Extension: connected',
        '[SKIP] Connectivity: skipped (--no-live)',
        '',
        'Everything looks good!',
      ].join('\n'));
    });

    const { getOpenCliStatus, warmupOpenCliDoctor } = await import('@electron/utils/opencli-runtime');
    const [, status] = await Promise.all([
      warmupOpenCliDoctor(),
      getOpenCliStatus(),
    ]);

    expect(status.doctor?.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });
});
