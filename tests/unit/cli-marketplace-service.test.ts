import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockExecFile,
  mockPrepareWinSpawn,
  mockSpawn,
} = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockPrepareWinSpawn: vi.fn((command: string, args: string[], forceShell?: boolean) => ({
    command,
    args,
    shell: Boolean(forceShell),
  })),
  mockSpawn: vi.fn(),
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

function createSuccessfulChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  setTimeout(() => {
    child.emit('close', 0);
  }, 0);

  return child;
}

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: mockExecFile,
    spawn: mockSpawn,
    default: {
      ...actual,
      execFile: mockExecFile,
      spawn: mockSpawn,
    },
  };
});

vi.mock('@electron/utils/managed-bin', async () => {
  const actual = await vi.importActual<typeof import('@electron/utils/managed-bin')>('@electron/utils/managed-bin');
  return {
    ...actual,
    getBundledNpmPath: vi.fn(() => 'C:\\Program Files\\GeeClaw\\resources\\bin\\npm.cmd'),
  };
});

vi.mock('@electron/utils/win-shell', async () => {
  const actual = await vi.importActual<typeof import('@electron/utils/win-shell')>('@electron/utils/win-shell');
  return {
    ...actual,
    prepareWinSpawn: mockPrepareWinSpawn,
  };
});

describe('cli marketplace service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockSpawn.mockImplementation(() => createSuccessfulChildProcess());
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('marks a CLI as installed when a system command is detected', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        { id: 'feishu', title: 'Feishu CLI', packageName: '@geeclaw-test/feishu-cli', binNames: ['feishu'] },
      ],
      findCommand: vi.fn(async (bin: string) => (bin === 'feishu' ? '/usr/local/bin/feishu' : null)),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).resolves.toEqual([
      expect.objectContaining({
        id: 'feishu',
        installed: true,
        actionLabel: 'reinstall',
        source: 'system',
      }),
    ]);
  });

  it('installs a curated package into the GeeClaw prefix', async () => {
    const installWithBundledNpm = vi.fn(async () => undefined);
    const ensureManagedPrefixOnUserPath = vi.fn(async () => 'updated');
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const managedPrefixDir = join(process.cwd(), 'tmp', 'cli-marketplace-prefix');

    const service = new CliMarketplaceService({
      catalogEntries: [
        { id: 'wecom', title: 'WeCom CLI', packageName: '@geeclaw-test/wecom-cli', binNames: ['wecom'] },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => true),
      installWithBundledNpm,
      ensureManagedPrefixOnUserPath,
      managedPrefixDir,
    });

    await service.install({ id: 'wecom' });

    expect(installWithBundledNpm).toHaveBeenCalledWith(
      '@geeclaw-test/wecom-cli',
      [],
      expect.objectContaining({ prefixDir: expect.any(String) }),
    );
    expect(ensureManagedPrefixOnUserPath).toHaveBeenCalledWith(managedPrefixDir);
  });

  it('throws when catalog entries fail validation', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'broken',
          title: 'Broken CLI',
          packageName: '@geeclaw-test/broken-cli',
          binNames: [],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).rejects.toThrow('binNames');
  });

  it('forces shell execution for absolute npm.cmd installs on Windows', async () => {
    setPlatform('win32');
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');
    const ensureManagedPrefixOnUserPath = vi.fn(async () => 'updated');

    const service = new CliMarketplaceService({
      catalogEntries: [
        { id: 'wecom', title: 'WeCom CLI', packageName: '@geeclaw-test/wecom-cli', binNames: ['wecom'] },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => true),
      ensureManagedPrefixOnUserPath,
      managedPrefixDir: join(process.cwd(), 'tmp', 'cli-marketplace-prefix-win'),
    });

    await service.install({ id: 'wecom' });

    expect(mockPrepareWinSpawn).toHaveBeenCalledWith(
      'C:\\Program Files\\GeeClaw\\resources\\bin\\npm.cmd',
      ['install', '--global', '@geeclaw-test/wecom-cli'],
      true,
    );
  });

  it('keeps install successful when PATH update fails', async () => {
    const installWithBundledNpm = vi.fn(async () => undefined);
    const ensureManagedPrefixOnUserPath = vi.fn(async () => {
      throw new Error('failed to update PATH');
    });
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        { id: 'wecom', title: 'WeCom CLI', packageName: '@geeclaw-test/wecom-cli', binNames: ['wecom'] },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => true),
      installWithBundledNpm,
      ensureManagedPrefixOnUserPath,
      managedPrefixDir: join(process.cwd(), 'tmp', 'cli-marketplace-prefix-warn'),
    });

    await expect(service.install({ id: 'wecom' })).resolves.toEqual(
      expect.objectContaining({
        id: 'wecom',
        installed: true,
        source: 'geeclaw',
      }),
    );
  });
});
