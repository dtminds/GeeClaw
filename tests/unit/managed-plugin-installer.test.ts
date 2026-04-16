import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

afterEach(() => {
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('managed plugin installer', () => {
  it('skips installation when the exact target version is already present', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const pluginDir = join(configDir, 'extensions', 'lossless-claw');
    mkdirSync(pluginDir, { recursive: true });
    writeJson(join(pluginDir, 'package.json'), {
      name: '@martian-engineering/lossless-claw',
      version: '0.5.2',
      openclaw: { extensions: ['./dist/index.js'] },
    });
    writeFileSync(join(pluginDir, 'stale.txt'), 'stale\n', 'utf8');

    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ filename: 'lossless-claw-0.5.2.tgz' }]),
        stderr: '',
      });
    const extractPackage = vi.fn(async ({ destinationRoot }: { destinationRoot: string }) => {
      mkdirSync(join(destinationRoot, 'dist'), { recursive: true });
      writeJson(join(destinationRoot, 'package.json'), {
        name: '@martian-engineering/lossless-claw',
        version: '0.5.2',
        openclaw: { extensions: ['./dist/index.js'] },
      });
      writeFileSync(join(destinationRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
    });

    const result = await ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.5.2',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: true,
        startupInstallPolicy: 'missing-or-outdated',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand,
      extractPackage,
    });

    expect(result).toEqual({
      action: 'noop',
      pluginId: 'lossless-claw',
      installedVersion: '0.5.2',
      previousVersion: '0.5.2',
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(extractPackage).not.toHaveBeenCalled();
    expect(readFileSync(join(pluginDir, 'stale.txt'), 'utf8')).toBe('stale\n');
  });

  it('installs a missing plugin into staging and atomically promotes it', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const extractedRoot = makeTempDir('managed-plugin-package-');
    mkdirSync(join(extractedRoot, 'dist'), { recursive: true });
    writeJson(join(extractedRoot, 'package.json'), {
      name: '@martian-engineering/lossless-claw',
      version: '0.5.2',
      openclaw: { extensions: ['./dist/index.js'] },
      dependencies: {
        zod: '^4.0.0',
      },
    });
    writeFileSync(join(extractedRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');

    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ filename: 'lossless-claw-0.9.1.tgz' }]),
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      });

    const result = await ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.5.2',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: true,
        startupInstallPolicy: 'missing-or-outdated',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand,
      extractPackage: vi.fn(async ({ destinationRoot }: { destinationRoot: string }) => {
        mkdirSync(destinationRoot, { recursive: true });
        writeJson(join(destinationRoot, 'package.json'), JSON.parse(readFileSync(join(extractedRoot, 'package.json'), 'utf8')));
        mkdirSync(join(destinationRoot, 'dist'), { recursive: true });
        writeFileSync(join(destinationRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
      }),
    });

    expect(result).toEqual({
      action: 'installed',
      pluginId: 'lossless-claw',
      installedVersion: '0.5.2',
      previousVersion: null,
    });
    expect(runCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: 'npm',
      args: ['pack', '@martian-engineering/lossless-claw@0.5.2', '--ignore-scripts', '--json'],
    }));
    expect(runCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'npm',
      args: ['install', '--omit=dev', '--ignore-scripts', '--silent'],
    }));
    expect(JSON.parse(readFileSync(join(configDir, 'extensions', 'lossless-claw', 'package.json'), 'utf8')).version).toBe('0.5.2');
  });

  it('fails validation when openclaw.extensions is missing and removes the final directory', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const staleFinalDir = join(configDir, 'extensions', 'lossless-claw');
    mkdirSync(staleFinalDir, { recursive: true });
    writeJson(join(staleFinalDir, 'package.json'), { version: '0.5.1' });

    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    await expect(ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.5.2',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: true,
        startupInstallPolicy: 'missing-or-outdated',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand: vi.fn().mockResolvedValue({
        stdout: JSON.stringify([{ filename: 'lossless-claw-0.5.2.tgz' }]),
        stderr: '',
      }),
      extractPackage: vi.fn(async ({ destinationRoot }: { destinationRoot: string }) => {
        mkdirSync(destinationRoot, { recursive: true });
        writeJson(join(destinationRoot, 'package.json'), {
          name: '@martian-engineering/lossless-claw',
          version: '0.5.2',
        });
      }),
    })).rejects.toThrow(/openclaw\.extensions/i);

    expect(() => readFileSync(join(configDir, 'extensions', 'lossless-claw', 'package.json'), 'utf8')).toThrow();
  });

  it('removes the final directory when dependency installation fails', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const staleFinalDir = join(configDir, 'extensions', 'lossless-claw');
    mkdirSync(staleFinalDir, { recursive: true });
    writeJson(join(staleFinalDir, 'package.json'), { version: '0.5.1' });

    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    await expect(ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.5.2',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: true,
        startupInstallPolicy: 'missing-or-outdated',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand: vi.fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ filename: 'lossless-claw-0.5.2.tgz' }]),
          stderr: '',
        })
        .mockRejectedValueOnce(new Error('npm install failed')),
      extractPackage: vi.fn(async ({ destinationRoot }: { destinationRoot: string }) => {
        mkdirSync(join(destinationRoot, 'dist'), { recursive: true });
        writeJson(join(destinationRoot, 'package.json'), {
          name: '@martian-engineering/lossless-claw',
          version: '0.5.2',
          openclaw: { extensions: ['./dist/index.js'] },
          dependencies: {
            zod: '^4.0.0',
          },
        });
        writeFileSync(join(destinationRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
      }),
    })).rejects.toThrow(/npm install failed/);

    expect(() => readFileSync(join(configDir, 'extensions', 'lossless-claw', 'package.json'), 'utf8')).toThrow();
  });

  it('removes the existing final directory when npm pack fails', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const staleFinalDir = join(configDir, 'extensions', 'lossless-claw');
    mkdirSync(staleFinalDir, { recursive: true });
    writeJson(join(staleFinalDir, 'package.json'), { version: '0.5.1' });

    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    await expect(ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.5.2',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: true,
        startupInstallPolicy: 'missing-or-outdated',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand: vi.fn().mockRejectedValue(new Error('npm pack failed')),
      extractPackage: vi.fn(),
    })).rejects.toThrow(/npm pack failed/);

    expect(() => readFileSync(join(configDir, 'extensions', 'lossless-claw', 'package.json'), 'utf8')).toThrow();
  });

  it('skips installation when the plugin is missing and startup policy is outdated-only', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    const runCommand = vi.fn();
    const extractPackage = vi.fn();

    const result = await ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.9.1',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: false,
        startupInstallPolicy: 'outdated-only',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand,
      extractPackage,
    });

    expect(result).toEqual({
      action: 'noop',
      pluginId: 'lossless-claw',
      installedVersion: '',
      previousVersion: null,
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(extractPackage).not.toHaveBeenCalled();
    expect(() => readFileSync(join(configDir, 'extensions', 'lossless-claw', 'package.json'), 'utf8')).toThrow();
  });

  it('skips installation when the installed version is newer than the pinned version', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const pluginDir = join(configDir, 'extensions', 'lossless-claw');
    mkdirSync(pluginDir, { recursive: true });
    writeJson(join(pluginDir, 'package.json'), {
      name: '@martian-engineering/lossless-claw',
      version: '0.9.2',
      openclaw: { extensions: ['./dist/index.js'] },
    });

    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    const runCommand = vi.fn();
    const extractPackage = vi.fn();

    const result = await ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.9.1',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: false,
        startupInstallPolicy: 'outdated-only',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand,
      extractPackage,
    });

    expect(result).toEqual({
      action: 'noop',
      pluginId: 'lossless-claw',
      installedVersion: '0.9.2',
      previousVersion: '0.9.2',
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(extractPackage).not.toHaveBeenCalled();
  });

  it('installs a missing plugin when reconcile policy is requested', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ filename: 'lossless-claw-0.9.1.tgz' }]),
        stderr: '',
      });
    const extractPackage = vi.fn(async ({ destinationRoot }: { destinationRoot: string }) => {
      mkdirSync(join(destinationRoot, 'dist'), { recursive: true });
      writeJson(join(destinationRoot, 'package.json'), {
        name: '@martian-engineering/lossless-claw',
        version: '0.9.1',
        openclaw: { extensions: ['./dist/index.js'] },
      });
      writeFileSync(join(destinationRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
    });

    const result = await ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.9.1',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: false,
        startupInstallPolicy: 'outdated-only',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand,
      extractPackage,
      installPolicy: 'reconcile',
    });

    expect(result).toEqual({
      action: 'installed',
      pluginId: 'lossless-claw',
      installedVersion: '0.9.1',
      previousVersion: null,
    });
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('reinstalls a newer mismatched version when reconcile policy is requested', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const pluginDir = join(configDir, 'extensions', 'lossless-claw');
    mkdirSync(pluginDir, { recursive: true });
    writeJson(join(pluginDir, 'package.json'), {
      name: '@martian-engineering/lossless-claw',
      version: '0.9.2',
      openclaw: { extensions: ['./dist/index.js'] },
    });

    const { ensureManagedPluginInstalled } = await import('@electron/utils/managed-plugin-installer');

    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ filename: 'lossless-claw-0.9.1.tgz' }]),
        stderr: '',
      });
    const extractPackage = vi.fn(async ({ destinationRoot }: { destinationRoot: string }) => {
      mkdirSync(join(destinationRoot, 'dist'), { recursive: true });
      writeJson(join(destinationRoot, 'package.json'), {
        name: '@martian-engineering/lossless-claw',
        version: '0.9.1',
        openclaw: { extensions: ['./dist/index.js'] },
      });
      writeFileSync(join(destinationRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
    });

    const result = await ensureManagedPluginInstalled({
      plugin: {
        pluginId: 'lossless-claw',
        packageName: '@martian-engineering/lossless-claw',
        targetVersion: '0.9.1',
        displayName: 'lossless-claw',
        installMessage: '正在安装 lossless-claw 插件…',
        requiredForStartup: false,
        startupInstallPolicy: 'outdated-only',
        syncConfigOnStartup: true,
      },
      configDir,
      runCommand,
      extractPackage,
      installPolicy: 'reconcile',
    });

    expect(result).toEqual({
      action: 'installed',
      pluginId: 'lossless-claw',
      installedVersion: '0.9.1',
      previousVersion: '0.9.2',
    });
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(join(configDir, 'extensions', 'lossless-claw', 'package.json'), 'utf8')).version).toBe('0.9.1');
  });

  it('does not clear another plugin that is still actively checking or installing', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const pluginDir = join(configDir, 'extensions', 'memory-core');
    mkdirSync(pluginDir, { recursive: true });
    writeJson(join(pluginDir, 'package.json'), {
      name: '@martian-engineering/memory-core',
      version: '1.2.3',
      openclaw: { extensions: ['./dist/index.js'] },
    });

    const { ensureManagedPluginsReadyBeforeGatewayLaunch } = await import('@electron/utils/managed-plugin-installer');
    const { getManagedPluginStatus, setManagedPluginStatus } = await import('@electron/utils/managed-plugin-status');

    setManagedPluginStatus({
      pluginId: 'lossless-claw',
      displayName: 'lossless-claw',
      stage: 'installing',
      message: '正在安装 lossless-claw 依赖…',
      targetVersion: '0.9.1',
      installedVersion: null,
    });

    await ensureManagedPluginsReadyBeforeGatewayLaunch({
      plugins: [{
        pluginId: 'memory-core',
        packageName: '@martian-engineering/memory-core',
        targetVersion: '1.2.3',
        displayName: 'memory-core',
        installMessage: '正在安装 memory-core 插件…',
        requiredForStartup: false,
        startupInstallPolicy: 'missing-or-outdated',
        syncConfigOnStartup: true,
      }],
      openclawConfigDir: configDir,
      finalPath: process.env.PATH ?? '',
      managedAppEnv: {},
      uvEnv: {},
      proxyEnv: {},
    });

    expect(getManagedPluginStatus()).toEqual(expect.objectContaining({
      pluginId: 'lossless-claw',
      stage: 'installing',
    }));
  });

  it('clears a stale terminal status when a later plugin is a startup no-op', async () => {
    const configDir = makeTempDir('managed-plugin-config-');
    const pluginDir = join(configDir, 'extensions', 'memory-core');
    mkdirSync(pluginDir, { recursive: true });
    writeJson(join(pluginDir, 'package.json'), {
      name: '@martian-engineering/memory-core',
      version: '1.2.3',
      openclaw: { extensions: ['./dist/index.js'] },
    });

    const { ensureManagedPluginsReadyBeforeGatewayLaunch } = await import('@electron/utils/managed-plugin-installer');
    const { getManagedPluginStatus, setManagedPluginStatus } = await import('@electron/utils/managed-plugin-status');

    setManagedPluginStatus({
      pluginId: 'lossless-claw',
      displayName: 'lossless-claw',
      stage: 'installed',
      message: '正在安装 lossless-claw 插件…',
      targetVersion: '0.9.1',
      installedVersion: '0.9.1',
    });

    await ensureManagedPluginsReadyBeforeGatewayLaunch({
      plugins: [{
        pluginId: 'memory-core',
        packageName: '@martian-engineering/memory-core',
        targetVersion: '1.2.3',
        displayName: 'memory-core',
        installMessage: '正在安装 memory-core 插件…',
        requiredForStartup: false,
        startupInstallPolicy: 'missing-or-outdated',
        syncConfigOnStartup: true,
      }],
      openclawConfigDir: configDir,
      finalPath: process.env.PATH ?? '',
      managedAppEnv: {},
      uvEnv: {},
      proxyEnv: {},
    });

    expect(getManagedPluginStatus()).toBeNull();
  });
});
