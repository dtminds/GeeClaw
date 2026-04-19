import { homedir } from 'node:os';
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
    getBundledNpxPath: vi.fn(() => 'C:\\Program Files\\GeeClaw\\resources\\bin\\npx.cmd'),
    getBundledPathEntries: vi.fn(() => []),
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

  it('marks a CLI as geeclaw when the detected command path is inside the managed prefix', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');
    const managedPrefixDir = join(process.cwd(), 'tmp', 'cli-marketplace-detect-managed-prefix');

    const service = new CliMarketplaceService({
      catalogEntries: [
        { id: 'opencli', title: 'OpenCLI', packageName: '@jackwener/opencli', binNames: ['opencli'] },
      ],
      managedPrefixDir,
      findCommand: vi.fn(async (bin: string) => (
        bin === 'opencli'
          ? join(managedPrefixDir, 'bin', 'opencli')
          : null
      )),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).resolves.toEqual([
      expect.objectContaining({
        id: 'opencli',
        installed: true,
        actionLabel: 'reinstall',
        source: 'geeclaw',
      }),
    ]);
  });

  it('reports manual-only brew install method as available when brew exists on PATH', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'foo',
          title: 'Foo CLI',
          binNames: ['foo'],
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install foo', requiresCommands: ['brew'] },
          ],
        },
      ],
      findCommand: vi.fn(async (bin: string) => (bin === 'brew' ? '/opt/homebrew/bin/brew' : null)),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).resolves.toEqual([
      expect.objectContaining({
        id: 'foo',
        source: 'none',
        actionLabel: null,
        installMethods: [
          expect.objectContaining({
            type: 'manual',
            label: 'brew',
            command: 'brew install foo',
            available: true,
            managed: false,
          }),
        ],
      }),
    ]);
  });

  it('preserves docsUrl metadata in catalog status items', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'foo',
          title: 'Foo CLI',
          binNames: ['foo'],
          docsUrl: 'https://example.com/foo-docs',
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install foo', requiresCommands: ['brew'] },
          ],
        },
      ],
      findCommand: vi.fn(async (bin: string) => (bin === 'brew' ? '/opt/homebrew/bin/brew' : null)),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).resolves.toEqual([
      expect.objectContaining({
        id: 'foo',
        docsUrl: 'https://example.com/foo-docs',
      }),
    ]);
  });

  it('reports missing-command for manual-only brew install method when brew is absent', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'foo',
          title: 'Foo CLI',
          binNames: ['foo'],
          docsUrl: 'https://example.com/foo-docs',
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install foo', requiresCommands: ['brew'] },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).resolves.toEqual([
      expect.objectContaining({
        id: 'foo',
        source: 'none',
        actionLabel: null,
        installMethods: [
          expect.objectContaining({
            type: 'manual',
            label: 'brew',
            command: 'brew install foo',
            available: false,
            unavailableReason: 'missing-command',
            missingCommands: ['brew'],
            managed: false,
          }),
        ],
      }),
    ]);
  });

  it('returns mixed managed-npm and manual install methods for a catalog entry', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'bar',
          title: 'Bar CLI',
          binNames: ['bar'],
          installMethods: [
            {
              type: 'managed-npm',
              packageName: '@geeclaw-test/bar-cli',
            },
            {
              type: 'manual',
              label: 'brew',
              command: 'brew install bar',
              requiresCommands: ['brew'],
            },
          ],
        },
      ],
      findCommand: vi.fn(async (bin: string) => (bin === 'brew' ? '/usr/local/bin/brew' : null)),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).resolves.toEqual([
      expect.objectContaining({
        id: 'bar',
        installMethods: [
          expect.objectContaining({
            type: 'managed-npm',
            label: 'managed-npm',
            available: true,
            managed: true,
          }),
          expect.objectContaining({
            type: 'manual',
            label: 'brew',
            command: 'brew install bar',
            available: true,
            managed: false,
          }),
        ],
      }),
    ]);
  });

  it('keeps system-installed CLIs non-uninstallable even when manual uninstall metadata exists', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'baz',
          title: 'Baz CLI',
          binNames: ['baz'],
          installMethods: [
            {
              type: 'manual',
              label: 'brew',
              command: 'brew install baz',
              requiresCommands: ['brew'],
            },
          ],
        },
      ],
      findCommand: vi.fn(async (bin: string) => (bin === 'baz' ? '/usr/local/bin/baz' : null)),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).resolves.toEqual([
      expect.objectContaining({
        id: 'baz',
        installed: true,
        source: 'system',
        actionLabel: null,
        installMethods: [
          expect.objectContaining({
            type: 'manual',
            label: 'brew',
            command: 'brew install baz',
          }),
        ],
      }),
    ]);
  });

  it('rejects install for entries that only provide manual install methods', async () => {
    const installWithBundledNpm = vi.fn(async () => undefined);
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'manual-only',
          title: 'Manual only CLI',
          binNames: ['manual-only'],
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install manual-only', requiresCommands: ['brew'] },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
      installWithBundledNpm,
    });

    await expect(service.install({ id: 'manual-only' })).rejects.toThrow(
      'Catalog entry "manual-only" does not support managed install',
    );
    expect(installWithBundledNpm).not.toHaveBeenCalled();
  });

  it('rejects uninstall for entries that only provide manual install methods', async () => {
    const uninstallWithBundledNpm = vi.fn(async () => undefined);
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'manual-only',
          title: 'Manual only CLI',
          binNames: ['manual-only'],
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install manual-only', requiresCommands: ['brew'] },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
      uninstallWithBundledNpm,
    });

    await expect(service.uninstall({ id: 'manual-only' })).rejects.toThrow(
      'Catalog entry "manual-only" does not support managed install',
    );
    expect(uninstallWithBundledNpm).not.toHaveBeenCalled();
  });

  it('rejects install job start for entries that only provide manual install methods', async () => {
    const installWithBundledNpm = vi.fn(async () => undefined);
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'manual-only',
          title: 'Manual only CLI',
          binNames: ['manual-only'],
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install manual-only', requiresCommands: ['brew'] },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
      installWithBundledNpm,
    });

    await expect(service.startInstallJob({ id: 'manual-only' })).rejects.toThrow(
      'Catalog entry "manual-only" does not support managed install',
    );
    expect(installWithBundledNpm).not.toHaveBeenCalled();
  });

  it('rejects uninstall job start for entries that only provide manual install methods', async () => {
    const uninstallWithBundledNpm = vi.fn(async () => undefined);
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'manual-only',
          title: 'Manual only CLI',
          binNames: ['manual-only'],
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install manual-only', requiresCommands: ['brew'] },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
      uninstallWithBundledNpm,
    });

    await expect(service.startUninstallJob({ id: 'manual-only' })).rejects.toThrow(
      'Catalog entry "manual-only" does not support managed install',
    );
    expect(uninstallWithBundledNpm).not.toHaveBeenCalled();
  });

  it('installs a curated package into the GeeClaw prefix', async () => {
    const installWithBundledNpm = vi.fn(async () => undefined);
    const runSkillCommandWithBundledNpx = vi.fn(async () => undefined);
    const ensureManagedPrefixOnUserPath = vi.fn(async () => 'updated');
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const managedPrefixDir = join(process.cwd(), 'tmp', 'cli-marketplace-prefix');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'wecom',
          title: 'WeCom CLI',
          packageName: '@geeclaw-test/wecom-cli',
          binNames: ['wecom'],
          postInstallSkills: ['WeComTeam/wecom-cli'],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => true),
      installWithBundledNpm,
      runSkillCommandWithBundledNpx,
      ensureManagedPrefixOnUserPath,
      managedPrefixDir,
    });

    await service.install({ id: 'wecom' });

    expect(installWithBundledNpm).toHaveBeenCalledWith(
      '@geeclaw-test/wecom-cli',
      [],
      expect.objectContaining({ prefixDir: expect.any(String) }),
    );
    expect(runSkillCommandWithBundledNpx).toHaveBeenCalledWith(
      'add',
      'WeComTeam/wecom-cli',
      expect.objectContaining({ prefixDir: managedPrefixDir }),
    );
    expect(ensureManagedPrefixOnUserPath).toHaveBeenCalledWith(managedPrefixDir);
  });

  it('runs structured post-install actions and exposes install completion metadata on jobs', async () => {
    const installWithBundledNpm = vi.fn(async () => undefined);
    const runSkillCommandWithBundledNpx = vi.fn(async () => undefined);
    const runInstalledBinCommand = vi.fn(async () => undefined);
    const ensureManagedPrefixOnUserPath = vi.fn(async () => 'updated');
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const managedPrefixDir = join(process.cwd(), 'tmp', 'cli-marketplace-prefix-dokobot');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'dokobot',
          title: 'Dokobot',
          binNames: ['dokobot'],
          installMethods: [
            {
              type: 'managed-npm',
              packageName: '@dokobot/cli',
              postInstallActions: [
                { type: 'install-skills', sources: ['dokobot/dokobot'] },
                { type: 'run-installed-bin', bin: 'dokobot', args: ['install-skill', '-o', '${openclawSkillsDir}'] },
              ],
              completion: {
                kind: 'skills-and-docs',
                requiresSkillEnable: true,
                docsUrl: 'https://dokobot.ai/zh-CN/guide',
                extraSteps: ['安装浏览器扩展', '启动或配置 bridge', '在技能页开启 Dokobot 技能'],
              },
            },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => true),
      installWithBundledNpm,
      runSkillCommandWithBundledNpx,
      runInstalledBinCommand,
      ensureManagedPrefixOnUserPath,
      managedPrefixDir,
    });

    const startedJob = await service.startInstallJob({ id: 'dokobot' });
    expect(startedJob.completion).toEqual({
      kind: 'skills-and-docs',
      requiresSkillEnable: true,
      docsUrl: 'https://dokobot.ai/zh-CN/guide',
      extraSteps: ['安装浏览器扩展', '启动或配置 bridge', '在技能页开启 Dokobot 技能'],
    });

    await vi.waitFor(() => {
      expect(service.getJob(startedJob.id).status).toBe('succeeded');
    });

    expect(runSkillCommandWithBundledNpx).toHaveBeenCalledWith(
      'add',
      'dokobot/dokobot',
      expect.objectContaining({ prefixDir: managedPrefixDir }),
    );
    expect(runInstalledBinCommand).toHaveBeenCalledWith(
      'dokobot',
      ['install-skill', '-o', join(homedir(), '.openclaw-geeclaw', 'skills')],
      expect.objectContaining({ prefixDir: managedPrefixDir }),
    );
  });

  it('does not inherit catalog docsUrl for skills-only completion actions', async () => {
    const installWithBundledNpm = vi.fn(async () => undefined);
    const ensureManagedPrefixOnUserPath = vi.fn(async () => 'updated');
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'wecom',
          title: 'WeCom CLI',
          binNames: ['wecom-cli'],
          docsUrl: 'https://github.com/WeComTeam/wecom-cli',
          installMethods: [
            {
              type: 'managed-npm',
              packageName: '@wecom/cli',
              completion: {
                kind: 'skills-only',
                requiresSkillEnable: true,
                extraSteps: ['在技能页开启企业微信 CLI 技能'],
              },
            },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => true),
      installWithBundledNpm,
      ensureManagedPrefixOnUserPath,
      managedPrefixDir: join(process.cwd(), 'tmp', 'cli-marketplace-prefix-skills-only'),
    });

    const startedJob = await service.startInstallJob({ id: 'wecom' });

    expect(startedJob.completion).toEqual({
      kind: 'skills-only',
      requiresSkillEnable: true,
      extraSteps: ['在技能页开启企业微信 CLI 技能'],
    });
  });

  it('uninstalls managed CLI packages and their skills', async () => {
    const uninstallWithBundledNpm = vi.fn(async () => undefined);
    const runSkillCommandWithBundledNpx = vi.fn(async () => undefined);
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const managedPrefixDir = join(process.cwd(), 'tmp', 'cli-marketplace-prefix-uninstall');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'feishu',
          title: 'Feishu CLI',
          packageName: '@geeclaw-test/feishu-cli',
          binNames: ['feishu'],
          postUninstallSkills: ['larksuite/cli'],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
      uninstallWithBundledNpm,
      runSkillCommandWithBundledNpx,
      managedPrefixDir,
    });

    await expect(service.uninstall({ id: 'feishu' })).resolves.toEqual(
      expect.objectContaining({
        id: 'feishu',
        installed: false,
        actionLabel: 'install',
      }),
    );

    expect(runSkillCommandWithBundledNpx).toHaveBeenCalledWith(
      'remove',
      'larksuite/cli',
      expect.objectContaining({ prefixDir: managedPrefixDir }),
    );
    expect(uninstallWithBundledNpm).toHaveBeenCalledWith(
      '@geeclaw-test/feishu-cli',
      expect.objectContaining({ prefixDir: managedPrefixDir }),
    );
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

  it('throws when catalog entries define multiple managed-npm install methods', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'dup-managed',
          title: 'Dup Managed CLI',
          binNames: ['dup-managed'],
          installMethods: [
            { type: 'managed-npm', packageName: '@geeclaw-test/dup-managed-a' },
            { type: 'managed-npm', packageName: '@geeclaw-test/dup-managed-b' },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).rejects.toThrow('multiple managed-npm');
  });

  it('throws when catalog entries mix legacy managed fields and explicit managed-npm methods', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'mixed-managed',
          title: 'Mixed managed CLI',
          packageName: '@geeclaw-test/mixed-managed-legacy',
          binNames: ['mixed-managed'],
          installMethods: [
            { type: 'managed-npm', packageName: '@geeclaw-test/mixed-managed-explicit' },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).rejects.toThrow('must not mix legacy managed fields');
  });

  it('throws when legacy postInstallSkills is an empty array', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'empty-post-install-skills',
          title: 'Empty post install skills CLI',
          packageName: '@geeclaw-test/empty-post-install-skills',
          binNames: ['empty-post-install-skills'],
          postInstallSkills: [],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).rejects.toThrow('postInstallSkills');
  });

  it('throws when install-skills action sources is an empty array', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'empty-install-skills-action',
          title: 'Empty install skills action CLI',
          binNames: ['empty-install-skills-action'],
          installMethods: [
            {
              type: 'managed-npm',
              packageName: '@geeclaw-test/empty-install-skills-action',
              postInstallActions: [
                { type: 'install-skills', sources: [] },
              ],
            },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).rejects.toThrow('install-skills sources');
  });

  it('throws when run-installed-bin action uses an unsupported template variable', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'bad-template-variable',
          title: 'Bad template variable CLI',
          binNames: ['bad-template-variable'],
          installMethods: [
            {
              type: 'managed-npm',
              packageName: '@geeclaw-test/bad-template-variable',
              postInstallActions: [
                { type: 'run-installed-bin', bin: 'bad-template-variable', args: ['install', '${unknownDir}'] },
              ],
            },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).rejects.toThrow('unsupported template variable');
  });

  it('throws when postUninstallSkills is an empty array', async () => {
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'empty-post-uninstall-skills',
          title: 'Empty post uninstall skills CLI',
          binNames: ['empty-post-uninstall-skills'],
          installMethods: [
            {
              type: 'managed-npm',
              packageName: '@geeclaw-test/empty-post-uninstall-skills',
              postUninstallSkills: [],
            },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await expect(service.getCatalog()).rejects.toThrow('postUninstallSkills');
  });

  it('fails fast when bundled npm runtime is missing for managed mutation APIs', async () => {
    const installWithBundledNpm = vi.fn(async () => undefined);
    const uninstallWithBundledNpm = vi.fn(async () => undefined);
    const { getBundledNpmPath } = await import('@electron/utils/managed-bin');
    const mockedGetBundledNpmPath = vi.mocked(getBundledNpmPath);
    mockedGetBundledNpmPath.mockReturnValueOnce(undefined);
    mockedGetBundledNpmPath.mockReturnValueOnce(undefined);
    mockedGetBundledNpmPath.mockReturnValueOnce(undefined);
    mockedGetBundledNpmPath.mockReturnValueOnce(undefined);
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'managed-runtime-missing',
          title: 'Managed runtime missing CLI',
          binNames: ['managed-runtime-missing'],
          installMethods: [
            { type: 'managed-npm', packageName: '@geeclaw-test/managed-runtime-missing' },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
      installWithBundledNpm,
      uninstallWithBundledNpm,
    });

    await expect(service.install({ id: 'managed-runtime-missing' })).rejects.toThrow('Bundled npm runtime is missing');
    await expect(service.uninstall({ id: 'managed-runtime-missing' })).rejects.toThrow('Bundled npm runtime is missing');
    await expect(service.startInstallJob({ id: 'managed-runtime-missing' })).rejects.toThrow('Bundled npm runtime is missing');
    await expect(service.startUninstallJob({ id: 'managed-runtime-missing' })).rejects.toThrow('Bundled npm runtime is missing');

    expect(installWithBundledNpm).not.toHaveBeenCalled();
    expect(uninstallWithBundledNpm).not.toHaveBeenCalled();
  });

  it('reuses required command lookups across catalog entries during a single getCatalog call', async () => {
    const findCommand = vi.fn(async (bin: string) => {
      if (bin === 'brew') return '/opt/homebrew/bin/brew';
      return null;
    });
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'foo',
          title: 'Foo CLI',
          binNames: ['foo'],
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install foo', requiresCommands: ['brew'] },
          ],
        },
        {
          id: 'bar',
          title: 'Bar CLI',
          binNames: ['bar'],
          installMethods: [
            { type: 'manual', label: 'brew', command: 'brew install bar', requiresCommands: ['brew'] },
          ],
        },
      ],
      findCommand,
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await service.getCatalog();

    expect(findCommand.mock.calls.filter(([bin]) => bin === 'brew')).toHaveLength(1);
  });

  it('checks bundled npm availability once per getCatalog call', async () => {
    const { getBundledNpmPath } = await import('@electron/utils/managed-bin');
    const mockedGetBundledNpmPath = vi.mocked(getBundledNpmPath);
    mockedGetBundledNpmPath.mockClear();
    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        {
          id: 'foo',
          title: 'Foo CLI',
          binNames: ['foo'],
          installMethods: [
            { type: 'managed-npm', packageName: '@geeclaw-test/foo-cli' },
          ],
        },
        {
          id: 'bar',
          title: 'Bar CLI',
          binNames: ['bar'],
          installMethods: [
            { type: 'managed-npm', packageName: '@geeclaw-test/bar-cli' },
          ],
        },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => false),
    });

    await service.getCatalog();

    expect(mockedGetBundledNpmPath).toHaveBeenCalledTimes(1);
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

  it('prepends bundled runtime paths when spawning bundled npm on POSIX', async () => {
    setPlatform('darwin');
    vi.doMock('@electron/utils/managed-bin', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/managed-bin')>('@electron/utils/managed-bin');
      return {
        ...actual,
        getBundledNpmPath: vi.fn(() => '/Applications/GeeClaw.app/Contents/Resources/bin/bin/npm'),
        getBundledNpxPath: vi.fn(() => '/Applications/GeeClaw.app/Contents/Resources/bin/bin/npx'),
        getBundledPathEntries: vi.fn(() => [
          '/Applications/GeeClaw.app/Contents/Resources/managed-bin',
          '/Applications/GeeClaw.app/Contents/Resources/bin/bin',
          '/Applications/GeeClaw.app/Contents/Resources/bin',
        ]),
      };
    });

    const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

    const service = new CliMarketplaceService({
      catalogEntries: [
        { id: 'opencli', title: 'OpenCLI', packageName: '@jackwener/opencli', binNames: ['opencli'] },
      ],
      findCommand: vi.fn(async () => null),
      commandExistsInManagedPrefix: vi.fn(async () => true),
      ensureManagedPrefixOnUserPath: vi.fn(async () => 'updated'),
      managedPrefixDir: join(process.cwd(), 'tmp', 'cli-marketplace-prefix-posix'),
    });

    await service.install({ id: 'opencli' });

    expect(mockSpawn).toHaveBeenCalledWith(
      '/Applications/GeeClaw.app/Contents/Resources/bin/bin/npm',
      ['install', '--global', '@jackwener/opencli'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: expect.stringContaining('/Applications/GeeClaw.app/Contents/Resources/managed-bin:/Applications/GeeClaw.app/Contents/Resources/bin/bin:/Applications/GeeClaw.app/Contents/Resources/bin'),
        }),
      }),
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
