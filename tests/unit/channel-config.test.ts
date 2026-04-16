import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

async function getMockedOpenClawConfigDir(): Promise<string> {
  const { getOpenClawConfigDir } = await import('@electron/utils/paths');
  return getOpenClawConfigDir();
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
    expect((config as {
      commands?: {
        restart?: boolean;
      };
    }).commands?.restart).toBe(true);
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

  it('stores dingtalk config flat for the strict-schema runtime while keeping a synthetic default account summary', async () => {
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

    const { listConfiguredChannelAccounts, readOpenClawConfig, saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('dingtalk', {
      enabled: true,
      clientId: 'dt-client-id',
      clientSecret: 'dt-client-secret',
    }, 'helper');

    const config = await readOpenClawConfig() as {
      channels?: {
        dingtalk?: Record<string, unknown>;
      };
    };

    expect(config.channels?.dingtalk).toMatchObject({
      enabled: true,
      clientId: 'dt-client-id',
      clientSecret: 'dt-client-secret',
    });
    expect(config.channels?.dingtalk).not.toHaveProperty('accounts');
    expect(config.channels?.dingtalk).not.toHaveProperty('defaultAccount');

    const summaries = await listConfiguredChannelAccounts();
    expect(summaries.dingtalk).toEqual({
      defaultAccount: 'default',
      accounts: [
        {
          accountId: 'default',
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

  it('rejects non-canonical account IDs', async () => {
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

    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await expect(saveChannelConfig('wecom', {
      botId: 'bot-1',
      secret: 'secret-1',
      enabled: true,
    }, 'Ops Bot')).rejects.toThrow('Invalid accountId format');
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

    const configDir = await getMockedOpenClawConfigDir();
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
          idleMinutes?: number;
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
        mode: 'idle',
        idleMinutes: 10080,
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

  it('normalizes stale wecom multi-account config during startup channel sync', async () => {
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

    const { getGeeClawChannelStore } = await import('../../electron/services/channels/store-instance');
    const store = await getGeeClawChannelStore();
    store.set('channels', {
      wecom: {
        accounts: {
          alpha: {
            enabled: true,
            botId: 'bot-alpha',
            secret: 'secret-alpha',
            dmPolicy: 'open',
            allowFrom: ['*'],
          },
          bravo: {
            enabled: true,
            botId: 'bot-bravo',
            secret: 'secret-bravo',
            dmPolicy: 'open',
            allowFrom: ['*'],
          },
          default: {
            enabled: true,
            dmPolicy: 'open',
            allowFrom: ['*'],
          },
        },
        defaultAccount: 'bravo',
        enabled: true,
        botId: 'bot-bravo',
        secret: 'secret-bravo',
      },
    });

    const { syncAllChannelConfigToOpenClaw } = await import('@electron/services/channels/channel-runtime-sync');
    const { readOpenClawConfig } = await import('@electron/utils/channel-config');

    await syncAllChannelConfigToOpenClaw();

    const config = await readOpenClawConfig() as {
      channels?: {
        wecom?: {
          enabled?: boolean;
          defaultAccount?: string;
          botId?: string;
          secret?: string;
          accounts?: Record<string, unknown>;
        };
      };
    };
    const storedChannels = store.get('channels') as {
      wecom?: {
        enabled?: boolean;
        defaultAccount?: string;
        botId?: string;
        secret?: string;
        accounts?: Record<string, unknown>;
      };
    };

    expect(config.channels?.wecom).toEqual({
      accounts: {
        alpha: {
          enabled: true,
          botId: 'bot-alpha',
          secret: 'secret-alpha',
          dmPolicy: 'open',
          allowFrom: ['*'],
        },
        bravo: {
          enabled: true,
          botId: 'bot-bravo',
          secret: 'secret-bravo',
          dmPolicy: 'open',
          allowFrom: ['*'],
        },
      },
      defaultAccount: 'bravo',
      enabled: true,
    });
    expect(storedChannels.wecom).toEqual(config.channels?.wecom);
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

    const configDir = await getMockedOpenClawConfigDir();
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
    expect(config.plugins?.entries?.feishu?.enabled).not.toBe(true);
  });

  it('enables the bundled openclaw-weixin plugin id when saving weixin config', async () => {
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

    const bundledPluginPath = join('/tmp/geeclaw-test-app', 'build', 'openclaw-plugins', 'openclaw-weixin');
    mkdirSync(bundledPluginPath, { recursive: true });
    writeFileSync(join(bundledPluginPath, 'openclaw.plugin.json'), '{"id":"openclaw-weixin"}\n', 'utf8');
    writeFileSync(join(bundledPluginPath, 'package.json'), '{"version":"1.0.2"}\n', 'utf8');

    const { readOpenClawConfig, saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('openclaw-weixin', { enabled: true }, 'wx-bot');

    const config = await readOpenClawConfig() as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, { enabled?: boolean }>;
      };
    };

    expect(config.plugins?.allow).toContain('openclaw-weixin');
    expect(config.plugins?.entries?.['openclaw-weixin']?.enabled).toBe(true);
  });

  it('preserves legacy managed plugin entries when saving weixin config', async () => {
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

    const bundledPluginPath = join('/tmp/geeclaw-test-app', 'build', 'openclaw-plugins', 'openclaw-weixin');
    mkdirSync(bundledPluginPath, { recursive: true });
    writeFileSync(join(bundledPluginPath, 'openclaw.plugin.json'), '{"id":"openclaw-weixin"}\n', 'utf8');
    writeFileSync(join(bundledPluginPath, 'package.json'), '{"version":"1.0.2"}\n', 'utf8');

    const configDir = await getMockedOpenClawConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      plugins: {
        allow: ['wecom-openclaw-plugin'],
        entries: {
          'wecom-openclaw-plugin': {
            enabled: true,
          },
        },
      },
    }, null, 2), 'utf8');

    const { readOpenClawConfig, saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('openclaw-weixin', { enabled: true }, 'wx-bot');

    const config = await readOpenClawConfig() as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, { enabled?: boolean }>;
      };
    };

    expect(config.plugins?.allow).toContain('wecom-openclaw-plugin');
    expect(config.plugins?.allow).toContain('openclaw-weixin');
    expect(config.plugins?.entries?.['wecom-openclaw-plugin']?.enabled).toBe(true);
    expect(config.plugins?.entries?.['openclaw-weixin']?.enabled).toBe(true);
  });

  it('persists managed plugin entries to the channel store using canonical plugin ids', async () => {
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
    const { getGeeClawChannelStore } = await import('../../electron/services/channels/store-instance');

    await saveChannelConfig('wecom', { enabled: true }, 'default');

    const store = await getGeeClawChannelStore();
    const storedPlugins = store.get('plugins') as Record<string, { enabled?: boolean }> | undefined;

    expect(storedPlugins?.['wecom-openclaw-plugin']?.enabled).toBe(true);
    expect(storedPlugins?.wecom).toBeUndefined();
  });

  it('lists weixin accounts discovered from plugin state files', async () => {
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

    const { saveWeixinAccountState } = await import('@electron/utils/weixin-state');
    const { listConfiguredChannelAccounts } = await import('@electron/utils/channel-config');

    await saveWeixinAccountState('wx-bot@im.bot', {
      token: 'token-1',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      userId: 'user@im.wechat',
    });

    const summaries = await listConfiguredChannelAccounts();

    expect(summaries['openclaw-weixin']).toEqual({
      defaultAccount: 'wx-bot-im-bot',
      accounts: [
        {
          accountId: 'wx-bot-im-bot',
          enabled: true,
          isDefault: true,
        },
      ],
    });
  });

  it.each([
    {
      channelType: 'dingtalk',
      allowIds: ['dingtalk'],
      entryIds: ['dingtalk'],
    },
    {
      channelType: 'wecom',
      allowIds: ['wecom-openclaw-plugin', 'wecom'],
      entryIds: ['wecom-openclaw-plugin', 'wecom'],
    },
    {
      channelType: 'feishu',
      allowIds: ['openclaw-lark', 'feishu'],
      entryIds: ['openclaw-lark', 'feishu'],
    },
    {
      channelType: 'openclaw-weixin',
      allowIds: ['openclaw-weixin'],
      entryIds: ['openclaw-weixin'],
    },
  ])('removes managed plugin registrations when deleting $channelType channel config', async ({
    channelType,
    allowIds,
    entryIds,
  }) => {
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

    const configDir = await getMockedOpenClawConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      channels: {
        [channelType]: {
          defaultAccount: 'default',
          accounts: {
            default: {
              enabled: true,
            },
          },
        },
      },
      plugins: {
        enabled: true,
        allow: allowIds,
        entries: Object.fromEntries(entryIds.map((entryId) => [entryId, { enabled: true }])),
      },
    }, null, 2), 'utf8');

    const { deleteChannelConfig, readOpenClawConfig } = await import('@electron/utils/channel-config');
    await deleteChannelConfig(channelType);

    const config = await readOpenClawConfig() as {
      channels?: Record<string, unknown>;
      plugins?: {
        allow?: string[];
        entries?: Record<string, unknown>;
      };
    };

    expect(config.channels?.[channelType]).toBeUndefined();
    for (const allowId of allowIds) {
      expect(config.plugins?.allow?.includes(allowId)).not.toBe(true);
    }
    for (const entryId of entryIds) {
      expect(config.plugins?.entries?.[entryId]).toBeUndefined();
    }
  });

  it('deletes the flat dingtalk channel config when deleting its implicit default account', async () => {
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

    const configDir = await getMockedOpenClawConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      channels: {
        dingtalk: {
          enabled: true,
          clientId: 'dt-client-id',
          clientSecret: 'dt-client-secret',
        },
      },
      plugins: {
        enabled: true,
        allow: ['dingtalk'],
        entries: {
          dingtalk: { enabled: true },
        },
      },
    }, null, 2), 'utf8');

    const { deleteChannelAccountConfig, readOpenClawConfig } = await import('@electron/utils/channel-config');
    await deleteChannelAccountConfig('dingtalk', 'default');

    const config = await readOpenClawConfig() as {
      channels?: Record<string, unknown>;
      plugins?: {
        allow?: string[];
        entries?: Record<string, unknown>;
      };
    };

    expect(config.channels?.dingtalk).toBeUndefined();
    expect(config.plugins?.allow?.includes('dingtalk')).not.toBe(true);
    expect(config.plugins?.entries?.dingtalk).toBeUndefined();
  });

  it.each([
    {
      channelType: 'dingtalk',
      allowIds: ['dingtalk'],
      entryIds: ['dingtalk'],
    },
    {
      channelType: 'wecom',
      allowIds: ['wecom-openclaw-plugin', 'wecom'],
      entryIds: ['wecom-openclaw-plugin', 'wecom'],
    },
    {
      channelType: 'feishu',
      allowIds: ['openclaw-lark', 'feishu'],
      entryIds: ['openclaw-lark', 'feishu'],
    },
    {
      channelType: 'openclaw-weixin',
      allowIds: ['openclaw-weixin'],
      entryIds: ['openclaw-weixin'],
    },
  ])('cleans dangling managed plugin state for $channelType without channel config', async ({
    channelType,
    allowIds,
    entryIds,
  }) => {
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

    const configDir = await getMockedOpenClawConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      plugins: {
        enabled: true,
        allow: allowIds,
        entries: Object.fromEntries(entryIds.map((entryId) => [entryId, { enabled: true }])),
      },
    }, null, 2), 'utf8');

    if (channelType === 'openclaw-weixin') {
      const staleStateDir = join(configDir, 'openclaw-weixin', 'accounts');
      mkdirSync(staleStateDir, { recursive: true });
      writeFileSync(join(staleStateDir, 'bot-im-bot.json'), JSON.stringify({ token: 'stale-token' }), 'utf8');
      writeFileSync(join(configDir, 'openclaw-weixin', 'accounts.json'), JSON.stringify(['bot-im-bot']), 'utf8');
    }

    const { cleanupDanglingManagedChannelPluginState, readOpenClawConfig } = await import('@electron/utils/channel-config');
    const before = await readOpenClawConfig() as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, unknown>;
      };
    };
    const result = await cleanupDanglingManagedChannelPluginState(channelType);
    const config = await readOpenClawConfig() as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, unknown>;
      };
    };

    for (const allowId of allowIds) {
      expect(before.plugins?.allow?.includes(allowId)).toBe(true);
    }
    for (const entryId of entryIds) {
      expect(before.plugins?.entries?.[entryId]).toBeDefined();
    }
    expect(result.cleanedDanglingState).toBe(true);
    for (const allowId of allowIds) {
      expect(config.plugins?.allow?.includes(allowId)).not.toBe(true);
    }
    for (const entryId of entryIds) {
      expect(config.plugins?.entries?.[entryId]).toBeUndefined();
    }
    if (channelType === 'openclaw-weixin') {
      expect(existsSync(join(configDir, 'openclaw-weixin'))).toBe(false);
    }
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

  it('removes legacy qqbot plugin registrations when deleting qqbot channel config', async () => {
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

    const configDir = await getMockedOpenClawConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      channels: {
        qqbot: {
          defaultAccount: 'default',
          accounts: {
            default: {
              enabled: true,
              appId: 'qq-app',
            },
          },
        },
      },
      plugins: {
        enabled: true,
        allow: ['qqbot', 'openclaw-qqbot'],
        entries: {
          qqbot: { enabled: true },
          'openclaw-qqbot': { enabled: true },
        },
      },
    }, null, 2), 'utf8');

    const { deleteChannelConfig, readOpenClawConfig } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('qqbot');

    const config = await readOpenClawConfig() as {
      channels?: Record<string, unknown>;
      plugins?: {
        allow?: string[];
        entries?: Record<string, unknown>;
      };
    };

    expect(config.channels?.qqbot).toBeUndefined();
    expect(config.plugins?.allow?.includes('qqbot')).not.toBe(true);
    expect(config.plugins?.allow?.includes('openclaw-qqbot')).not.toBe(true);
    expect(config.plugins?.entries?.qqbot).toBeUndefined();
    expect(config.plugins?.entries?.['openclaw-qqbot']).toBeUndefined();
  });

  it('saves whatsapp as a built-in channel instead of a plugin entry', async () => {
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
    await saveChannelConfig('whatsapp', { enabled: true }, 'default');

    const config = await readOpenClawConfig() as {
      channels?: {
        whatsapp?: {
          enabled?: boolean;
          defaultAccount?: string;
          accounts?: Record<string, { enabled?: boolean }>;
        };
      };
      plugins?: {
        entries?: Record<string, unknown>;
      };
    };

    expect(config.channels?.whatsapp?.enabled).toBe(true);
    expect(config.channels?.whatsapp?.defaultAccount).toBe('default');
    expect(config.channels?.whatsapp?.accounts?.default?.enabled).toBe(true);
    expect(config.plugins?.entries?.whatsapp).toBeUndefined();
  });

  it('preserves canonical whatsapp plugin registration when saving whatsapp config', async () => {
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

    const { readOpenClawConfig, saveChannelConfig, writeOpenClawConfig } = await import('@electron/utils/channel-config');
    await writeOpenClawConfig({
      plugins: {
        enabled: true,
        allow: ['whatsapp'],
        entries: {
          whatsapp: { enabled: true },
        },
      },
    });

    await saveChannelConfig('whatsapp', { enabled: true }, 'default');

    const config = await readOpenClawConfig() as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, unknown>;
      };
      channels?: {
        whatsapp?: {
          enabled?: boolean;
        };
      };
    };

    expect(config.plugins?.allow).toEqual(['whatsapp']);
    expect(config.plugins?.entries?.whatsapp).toEqual({ enabled: true });
    expect(config.channels?.whatsapp?.enabled).toBe(true);
  });

  it('preserves canonical channel plugin registrations while cleaning legacy qqbot ids on save', async () => {
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
    const configDir = await getMockedOpenClawConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      plugins: {
        enabled: true,
        allow: ['discord', 'whatsapp', 'qqbot', 'openclaw-qqbot'],
        entries: {
          discord: { enabled: true },
          whatsapp: { enabled: true },
          qqbot: { enabled: true },
          'openclaw-qqbot': { enabled: true },
        },
      },
    }, null, 2), 'utf8');

    await saveChannelConfig('discord', { token: 'discord-token' }, 'default');
    await saveChannelConfig('whatsapp', { enabled: true }, 'default');
    await saveChannelConfig('qqbot', { appId: 'qq-app', token: 'qq-token', appSecret: 'qq-secret' }, 'default');
    await saveChannelConfig('wecom', { corpId: 'corp-id', agentId: 'agent-id', secret: 'secret' }, 'default');

    const config = await readOpenClawConfig() as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, { enabled?: boolean }>;
      };
    };

    expect(config.plugins?.allow).toEqual(['discord', 'whatsapp', 'qqbot', 'wecom-openclaw-plugin']);
    expect(config.plugins?.entries?.discord).toEqual({ enabled: true });
    expect(config.plugins?.entries?.whatsapp).toEqual({ enabled: true });
    expect(config.plugins?.entries?.qqbot).toEqual({ enabled: true });
    expect(config.plugins?.allow).not.toContain('openclaw-qqbot');
    expect(config.plugins?.entries?.['openclaw-qqbot']).toBeUndefined();
  });

  it('removes canonical plugin registrations when deleting a built-in channel config', async () => {
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

    const configDir = await getMockedOpenClawConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      channels: {
        discord: {
          defaultAccount: 'default',
          accounts: {
            default: {
              enabled: true,
              token: 'discord-token',
            },
          },
        },
      },
      plugins: {
        enabled: true,
        allow: ['discord'],
        entries: {
          discord: { enabled: true },
        },
      },
    }, null, 2), 'utf8');

    const { deleteChannelConfig, readOpenClawConfig } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('discord');

    const config = await readOpenClawConfig() as {
      channels?: Record<string, unknown>;
      plugins?: {
        allow?: string[];
        entries?: Record<string, unknown>;
      };
    };

    expect(config.channels?.discord).toBeUndefined();
    expect(config.plugins?.allow?.includes('discord')).not.toBe(true);
    expect(config.plugins?.entries?.discord).toBeUndefined();
  });

  it('removes canonical and legacy qqbot plugin registrations when deleting agent-owned channel accounts', async () => {
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

    const configDir = await getMockedOpenClawConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      channels: {
        qqbot: {
          defaultAccount: 'helper',
          accounts: {
            helper: {
              enabled: true,
              appId: 'qq-app',
            },
          },
        },
      },
      plugins: {
        enabled: true,
        allow: ['qqbot', 'openclaw-qqbot'],
        entries: {
          qqbot: { enabled: true },
          'openclaw-qqbot': { enabled: true },
        },
      },
    }, null, 2), 'utf8');

    const { deleteAgentChannelAccounts, readOpenClawConfig } = await import('@electron/utils/channel-config');
    await deleteAgentChannelAccounts('helper');

    const config = await readOpenClawConfig() as {
      channels?: Record<string, unknown>;
      plugins?: {
        allow?: string[];
        entries?: Record<string, unknown>;
      };
    };

    expect(config.channels?.qqbot).toBeUndefined();
    expect(config.plugins?.allow?.includes('qqbot')).not.toBe(true);
    expect(config.plugins?.allow?.includes('openclaw-qqbot')).not.toBe(true);
    expect(config.plugins?.entries?.qqbot).toBeUndefined();
    expect(config.plugins?.entries?.['openclaw-qqbot']).toBeUndefined();
  });
});
