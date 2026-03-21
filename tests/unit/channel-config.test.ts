import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

function mockStores(): void {
  const channelStoreState: Record<string, unknown> = {};
  const agentStoreState: Record<string, unknown> = {};

  vi.doMock('../../electron/services/channels/store-instance', () => ({
    getGeeClawChannelStore: vi.fn(async () => ({
      get: (key: string) => channelStoreState[key],
      set: (key: string, value: unknown) => {
        channelStoreState[key] = JSON.parse(JSON.stringify(value));
      },
      delete: (key: string) => {
        delete channelStoreState[key];
      },
    })),
  }));

  vi.doMock('../../electron/services/agents/store-instance', () => ({
    getGeeClawAgentStore: vi.fn(async () => ({
      get: (key: string) => agentStoreState[key],
      set: (key: string, value: unknown) => {
        agentStoreState[key] = JSON.parse(JSON.stringify(value));
      },
      delete: (key: string) => {
        delete agentStoreState[key];
      },
    })),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.unmock('electron');
  vi.unmock('os');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('saveChannelConfig', () => {
  it('writes bundled plugin load paths for WeCom-managed extensions', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'channel-config-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => homeDir,
        getAppPath: () => '/tmp/geeclaw-test-app',
        getName: () => 'GeeClaw',
        getVersion: () => '0.0.1-test',
      },
    }));

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));
    mockStores();

    const bundledPluginPath = join('/tmp/geeclaw-test-app', 'build', 'openclaw-plugins', 'wecom-openclaw-plugin');
    mkdirSync(bundledPluginPath, { recursive: true });
    writeFileSync(join(bundledPluginPath, 'openclaw.plugin.json'), '{"id":"wecom-openclaw-plugin"}\n', 'utf8');
    writeFileSync(join(bundledPluginPath, 'package.json'), '{"version":"1.0.6"}\n', 'utf8');

    const { saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('wecom', { enabled: true });

    const config = JSON.parse(
      readFileSync(join(homeDir, '.openclaw-geeclaw', 'openclaw.json'), 'utf8'),
    ) as {
      plugins?: {
        allow?: string[];
        load?: {
          paths?: string[];
        };
      };
    };

    expect(config.plugins?.allow).toContain('wecom-openclaw-plugin');
    expect(config.plugins?.load?.paths).toContain(bundledPluginPath);
    expect((config as {
      plugins?: {
        entries?: Record<string, { enabled?: boolean }>;
      };
    }).plugins?.entries?.['wecom-openclaw-plugin']?.enabled).toBe(true);
  });

  it('does not synthesize a duplicate default account from mirrored top-level credentials', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'channel-config-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => homeDir,
        getAppPath: () => '/tmp/geeclaw-test-app',
        getName: () => 'GeeClaw',
        getVersion: () => '0.0.1-test',
      },
    }));

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));
    mockStores();

    const { listConfiguredChannelAccounts, saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('wecom', {
      botId: 'bot-1',
      secret: 'secret-1',
      enabled: true,
    }, 'xyclaw');

    const summaries = await listConfiguredChannelAccounts();

    expect(summaries.wecom).toEqual({
      defaultAccount: 'xyclaw',
      accounts: [
        {
          accountId: 'xyclaw',
          enabled: true,
          isDefault: true,
        },
      ],
    });
  });

  it('does not write session config when saving channel config', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'channel-config-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => homeDir,
        getAppPath: () => '/tmp/geeclaw-test-app',
        getName: () => 'GeeClaw',
        getVersion: () => '0.0.1-test',
      },
    }));

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));
    mockStores();

    const { readOpenClawConfig, saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('wecom', {
      botId: 'bot-1',
      secret: 'secret-1',
      enabled: true,
    }, 'xyclaw');

    const config = await readOpenClawConfig() as {
      session?: {
        dmScope?: string;
      };
    };

    expect(config.session).toBeUndefined();
  });

  it('reconciles managed session config during startup channel sync', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'channel-config-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => homeDir,
        getAppPath: () => '/tmp/geeclaw-test-app',
        getName: () => 'GeeClaw',
        getVersion: () => '0.0.1-test',
      },
    }));

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));
    mockStores();

    const configDir = join(homeDir, '.openclaw-geeclaw');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      session: {
        dmScope: 'per-channel-peer',
        reset: {
          mode: 'manual',
        },
      },
    }, null, 2), 'utf8');

    const { getGeeClawChannelStore } = await import('../../electron/services/channels/store-instance');
    const store = await getGeeClawChannelStore();
    store.set('channels', {
      wecom: {
        defaultAccount: 'xyclaw',
        accounts: {
          xyclaw: {
            botId: 'bot-1',
            secret: 'secret-1',
            enabled: true,
          },
        },
      },
    });

    const { syncAllChannelConfigToOpenClaw } = await import('@electron/services/channels/channel-runtime-sync');
    const { readOpenClawConfig } = await import('@electron/utils/channel-config');

    await syncAllChannelConfigToOpenClaw();

    const config = await readOpenClawConfig() as {
      session?: {
        dmScope?: string;
        reset?: {
          mode?: string;
          atHour?: number;
        };
        resetByType?: {
          direct?: {
            mode?: string;
            idleMinutes?: number;
          };
          group?: {
            mode?: string;
            idleMinutes?: number;
          };
          thread?: {
            mode?: string;
            atHour?: number;
          };
        };
        maintenance?: {
          mode?: string;
          pruneAfter?: string;
          maxEntries?: number;
          rotateBytes?: string;
          resetArchiveRetention?: string;
          maxDiskBytes?: string;
          highWaterBytes?: string;
        };
        threadBindings?: {
          enabled?: boolean;
          idleHours?: number;
          maxAgeHours?: number;
        };
        agentToAgent?: {
          maxPingPongTurns?: number;
        };
      };
    };

    expect(config.session).toEqual({
      dmScope: 'per-channel-peer',
      reset: {
        mode: 'daily',
        atHour: 4,
      },
      resetByType: {
        direct: {
          mode: 'idle',
          idleMinutes: 960,
        },
        group: {
          mode: 'idle',
          idleMinutes: 240,
        },
        thread: {
          mode: 'daily',
          atHour: 4,
        },
      },
      maintenance: {
        mode: 'enforce',
        pruneAfter: '30d',
        maxEntries: 500,
        rotateBytes: '10mb',
        resetArchiveRetention: '30d',
        maxDiskBytes: '500mb',
        highWaterBytes: '400mb',
      },
      threadBindings: {
        enabled: true,
        idleHours: 24,
        maxAgeHours: 0,
      },
      agentToAgent: {
        maxPingPongTurns: 5,
      },
    });
  });

  it('enables the canonical openclaw-lark plugin id for feishu', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'channel-config-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => homeDir,
        getAppPath: () => '/tmp/geeclaw-test-app',
        getName: () => 'GeeClaw',
        getVersion: () => '0.0.1-test',
      },
    }));

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));
    mockStores();

    const { readOpenClawConfig, saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('feishu', {
      appId: 'app-1',
      appSecret: 'secret-1',
      enabled: true,
    }, 'xyclaw');

    const config = await readOpenClawConfig() as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, { enabled?: boolean }>;
      };
    };

    expect(config.plugins?.allow).toContain('openclaw-lark');
    expect(config.plugins?.entries?.['openclaw-lark']?.enabled).toBe(true);
  });

  it('forces legacy plugins.entries.feishu to false when saving feishu config', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'channel-config-'));
    tempDirs.push(homeDir);
    vi.resetModules();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => homeDir,
        getAppPath: () => '/tmp/geeclaw-test-app',
        getName: () => 'GeeClaw',
        getVersion: () => '0.0.1-test',
      },
    }));

    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: {
        homedir: () => homeDir,
      },
    }));
    mockStores();

    const configDir = join(homeDir, '.openclaw-geeclaw');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      plugins: {
        allow: ['openclaw-lark', 'feishu'],
        entries: {
          'openclaw-lark': { enabled: true },
          feishu: { enabled: true },
        },
      },
    }, null, 2), 'utf8');

    const { readOpenClawConfig, saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('feishu', {
      appId: 'app-1',
      appSecret: 'secret-1',
      enabled: true,
    }, 'xyclaw');

    const config = await readOpenClawConfig() as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, { enabled?: boolean }>;
      };
    };

    expect(config.plugins?.allow).toContain('openclaw-lark');
    expect(config.plugins?.allow).not.toContain('feishu');
    expect(config.plugins?.entries?.['openclaw-lark']?.enabled).toBe(true);
    expect(config.plugins?.entries?.feishu?.enabled).toBe(false);
  });

  it('removes managed channel plugin ids from allow when the channel is disabled', async () => {
    const { reconcileManagedChannelPluginConfig } = await import('@electron/utils/channel-config');
    const config = {
      channels: {
        wecom: {
          enabled: false,
          accounts: {
            default: {
              enabled: true,
            },
          },
        },
      },
      plugins: {
        allow: ['wecom-openclaw-plugin', 'other-plugin'],
        entries: {
          'wecom-openclaw-plugin': {
            enabled: true,
          },
        },
      },
    };

    reconcileManagedChannelPluginConfig(config);

    expect(config.plugins?.allow).toEqual(['other-plugin']);
    expect(config.plugins?.entries?.['wecom-openclaw-plugin']?.enabled).toBe(false);
  });
});
