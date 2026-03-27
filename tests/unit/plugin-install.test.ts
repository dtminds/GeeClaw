import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/dev/null',
  },
}));

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createBundledPluginMirrorFixture(rootDir: string): { appRoot: string; bundledPluginsRoot: string } {
  const appRoot = join(rootDir, 'app');
  const bundledPluginsRoot = join(appRoot, 'build', 'openclaw-plugins');
  const nodeModulesRoot = join(appRoot, 'node_modules');
  const pnpmRoot = join(nodeModulesRoot, '.pnpm');
  const pluginDefs = [
    { pluginId: 'dingtalk', packageName: '@soimy/dingtalk' },
    { pluginId: 'wecom-openclaw-plugin', packageName: '@wecom/wecom-openclaw-plugin' },
    { pluginId: 'openclaw-weixin', packageName: '@tencent-weixin/openclaw-weixin' },
    { pluginId: 'qqbot', packageName: '@tencent-connect/openclaw-qqbot' },
    { pluginId: 'openclaw-lark', packageName: '@larksuite/openclaw-lark' },
    { pluginId: 'lossless-claw', packageName: '@martian-engineering/lossless-claw' },
    { pluginId: 'qmemory', packageName: 'qmemory' },
    { pluginId: 'cron-delivery-guard', packageName: 'cron-delivery-guard' },
  ];

  for (const plugin of pluginDefs) {
    const pluginDir = join(bundledPluginsRoot, plugin.pluginId);
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeJson(join(pluginDir, 'package.json'), {
      name: plugin.packageName,
      version: '1.0.6',
    });
    writeJson(join(pluginDir, 'openclaw.plugin.json'), {
      id: plugin.pluginId,
      channels: [plugin.pluginId],
    });
    writeFileSync(join(pluginDir, 'dist', 'index.esm.js'), 'export const plugin = true;\n', 'utf8');
  }

  const pluginStoreRoot = join(pnpmRoot, '@wecom+wecom-openclaw-plugin@1.0.6', 'node_modules');
  const pluginPackageDir = join(pluginStoreRoot, '@wecom', 'wecom-openclaw-plugin');
  const fileTypePackageDir = join(pnpmRoot, 'file-type@21.3.0', 'node_modules', 'file-type');

  mkdirSync(join(nodeModulesRoot, '@wecom'), { recursive: true });
  mkdirSync(join(pluginPackageDir, 'dist'), { recursive: true });
  mkdirSync(fileTypePackageDir, { recursive: true });

  writeJson(join(pluginPackageDir, 'package.json'), {
    name: '@wecom/wecom-openclaw-plugin',
    version: '1.0.6',
    peerDependencies: {
      openclaw: '>=2026.1.29',
    },
    dependencies: {
      'file-type': '^21.3.0',
    },
  });
  writeJson(join(pluginPackageDir, 'openclaw.plugin.json'), {
    id: 'wecom-openclaw-plugin',
    channels: ['wecom'],
  });
  writeFileSync(join(pluginPackageDir, 'dist', 'index.esm.js'), 'export const plugin = true;\n', 'utf8');

  writeJson(join(fileTypePackageDir, 'package.json'), {
    name: 'file-type',
    version: '21.3.0',
  });
  writeFileSync(join(fileTypePackageDir, 'index.js'), 'module.exports = {};\n', 'utf8');

  symlinkSync(
    '../.pnpm/@wecom+wecom-openclaw-plugin@1.0.6/node_modules/@wecom/wecom-openclaw-plugin',
    join(nodeModulesRoot, '@wecom', 'wecom-openclaw-plugin'),
  );
  symlinkSync(
    '../../file-type@21.3.0/node_modules/file-type',
    join(pluginStoreRoot, 'file-type'),
  );

  return { appRoot, bundledPluginsRoot };
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

describe('reconcileBundledPluginLoadPaths', () => {
  it('replaces managed user extension paths with current bundled plugin source paths', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'plugin-install-'));
    tempDirs.push(rootDir);

    const { appRoot, bundledPluginsRoot } = createBundledPluginMirrorFixture(rootDir);
    const { reconcileBundledPluginLoadPaths } = await import('@electron/utils/plugin-install');

    const config = {
      plugins: {
        load: {
          paths: [
            join(rootDir, 'home', '.openclaw-geeclaw', 'extensions', 'wecom-openclaw-plugin'),
            '/custom/plugins/keep-me',
          ],
        },
        installs: {
          'wecom-openclaw-plugin': {
            source: 'path',
            installPath: join(rootDir, 'home', '.openclaw-geeclaw', 'extensions', 'wecom-openclaw-plugin'),
          },
          'custom-plugin': {
            source: 'path',
            installPath: '/custom/plugins/keep-me',
          },
        },
      },
    };

    const result = reconcileBundledPluginLoadPaths(config, {
      appPath: appRoot,
      cwd: rootDir,
    });

    expect(result.warnings).toEqual([]);
    expect(config.plugins.load.paths).toContain('/custom/plugins/keep-me');
    expect(config.plugins.load.paths).toContain(bundledPluginsRoot);
    expect(config.plugins.load.paths).not.toContain(
      join(rootDir, 'home', '.openclaw-geeclaw', 'extensions', 'wecom-openclaw-plugin'),
    );
    expect(config.plugins.installs).toEqual({
      'custom-plugin': {
        source: 'path',
        installPath: '/custom/plugins/keep-me',
      },
    });
  });

  it('normalizes legacy plugins.load arrays into plugins.load.paths and strips managed installs', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'plugin-install-'));
    tempDirs.push(rootDir);

    const { appRoot, bundledPluginsRoot } = createBundledPluginMirrorFixture(rootDir);
    const { reconcileBundledPluginLoadPaths } = await import('@electron/utils/plugin-install');
    const config = {
      plugins: {
        load: [
          join(rootDir, 'home', '.openclaw-geeclaw', 'extensions', 'wecom-openclaw-plugin'),
          '/custom/plugins/keep-me',
        ],
        installs: {
          dingtalk: {
            source: 'path',
            installPath: join(rootDir, 'home', '.openclaw-geeclaw', 'extensions', 'dingtalk'),
          },
        },
      },
    };
    const reconcileResult = reconcileBundledPluginLoadPaths(config, {
      appPath: appRoot,
      cwd: rootDir,
    });

    expect(reconcileResult.warnings).toEqual([]);
    expect((config.plugins as { load?: { paths?: string[] } }).load?.paths).toContain('/custom/plugins/keep-me');
    expect((config.plugins as { load?: { paths?: string[] } }).load?.paths).toContain(bundledPluginsRoot);
    expect((config.plugins as { installs?: Record<string, unknown> }).installs).toBeUndefined();
  });

  it('replaces historical managed bundled plugin root paths from other environments', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'plugin-install-'));
    tempDirs.push(rootDir);

    const { appRoot, bundledPluginsRoot } = createBundledPluginMirrorFixture(rootDir);
    const { reconcileBundledPluginLoadPaths } = await import('@electron/utils/plugin-install');
    const config = {
      plugins: {
        load: {
          paths: [
            '/Applications/GeeClaw.app/Contents/Resources/openclaw-plugins',
            '/Applications/GeeClaw.app/Contents/Resources/app.asar.unpacked/openclaw-plugins',
            '/tmp/geeclaw-dev/plugins/openclaw',
            '/custom/plugins/keep-me',
          ],
        },
      },
    };

    const reconcileResult = reconcileBundledPluginLoadPaths(config, {
      appPath: appRoot,
      cwd: rootDir,
    });

    expect(reconcileResult.warnings).toEqual([]);
    expect((config.plugins as { load?: { paths?: string[] } }).load?.paths).toEqual([
      '/custom/plugins/keep-me',
      bundledPluginsRoot,
    ]);
  });

  it('forces always-enabled bundled plugins on during startup reconciliation', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'plugin-install-'));
    tempDirs.push(rootDir);

    createBundledPluginMirrorFixture(rootDir);
    const previousHome = process.env.HOME;
    process.env.HOME = join(rootDir, 'home');

    const configPath = join(process.env.HOME, '.openclaw-geeclaw', 'openclaw.json');
    mkdirSync(join(process.env.HOME, '.openclaw-geeclaw'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      plugins: {
        allow: ['custom-plugin'],
        entries: {
          'lossless-claw': {
            enabled: false,
            db: '~/.wrong/location.db',
            databasePath: '~/.also-wrong/location.db',
            config: {
              databasePath: '~/.also-wrong/location.db',
              customFlag: 'remove-me',
              freshTailCount: 64,
            },
          },
        },
      },
    }, null, 2), 'utf8');

    try {
      const {
        ALWAYS_ENABLED_BUNDLED_PLUGIN_IDS,
        ensureAlwaysEnabledBundledPluginsConfigured,
        getAlwaysEnabledBundledPluginIds,
      } = await import('@electron/utils/plugin-install');

      expect(ALWAYS_ENABLED_BUNDLED_PLUGIN_IDS).toEqual(['lossless-claw', 'qmemory', 'cron-delivery-guard']);
      expect(getAlwaysEnabledBundledPluginIds()).toEqual(['lossless-claw', 'qmemory', 'cron-delivery-guard']);

      const result = await ensureAlwaysEnabledBundledPluginsConfigured();
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        plugins?: {
          allow?: string[];
          entries?: Record<string, {
            enabled?: boolean;
            db?: string;
            databasePath?: string;
            config?: {
              dbPath?: string;
              databasePath?: string;
              ignoreSessionPatterns?: string[];
              statelessSessionPatterns?: string[];
              skipStatelessSessions?: boolean;
              freshTailCount?: number;
            };
          }>;
        };
      };

      expect(result).toEqual({
        success: true,
        updated: ['lossless-claw', 'qmemory', 'cron-delivery-guard'],
      });
      expect(config.plugins?.allow).toEqual(['custom-plugin', 'lossless-claw', 'qmemory', 'cron-delivery-guard']);
      expect(config.plugins?.entries).toEqual({
        'lossless-claw': {
          enabled: true,
          config: {
            dbPath: join(process.env.HOME, '.openclaw-geeclaw', 'lcm.db'),
            freshTailCount: 64,
            ignoreSessionPatterns: [
              'agent:*:cron:**',
              'agent:*:subagent:**',
            ],
            statelessSessionPatterns: [
              'agent:*:subagent:**',
              'agent:ops:subagent:**',
            ],
            skipStatelessSessions: true,
          },
        },
        qmemory: {
          enabled: true,
        },
        'cron-delivery-guard': {
          enabled: true,
        },
      });
      expect(config.plugins?.entries?.['lossless-claw']).toEqual({
        enabled: true,
        config: {
          dbPath: join(process.env.HOME, '.openclaw-geeclaw', 'lcm.db'),
          freshTailCount: 64,
          ignoreSessionPatterns: [
            'agent:*:cron:**',
            'agent:*:subagent:**',
          ],
          statelessSessionPatterns: [
            'agent:*:subagent:**',
            'agent:ops:subagent:**',
          ],
          skipStatelessSessions: true,
        },
      });
      expect(config.plugins?.entries?.qmemory).toEqual({
        enabled: true,
      });
      expect(config.plugins?.entries?.['cron-delivery-guard']).toEqual({
        enabled: true,
      });
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
