import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

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

describe('agent runtime sync', () => {
  it('restores stored agents, preserves skills, and recreates main agent metadata during startup sync', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'agent-runtime-sync-'));
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

    const agentStoreState: Record<string, unknown> = {};
    const channelStoreState: Record<string, unknown> = {};
    const agentStore = {
      get: (key: string) => agentStoreState[key],
      set: (key: string, value: unknown) => {
        agentStoreState[key] = JSON.parse(JSON.stringify(value));
      },
      delete: (key: string) => {
        delete agentStoreState[key];
      },
    };
    const channelStore = {
      get: (key: string) => channelStoreState[key],
      set: (key: string, value: unknown) => {
        channelStoreState[key] = JSON.parse(JSON.stringify(value));
      },
      delete: (key: string) => {
        delete channelStoreState[key];
      },
    };

    vi.doMock('../../electron/services/agents/store-instance', () => ({
      getGeeClawAgentStore: vi.fn(async () => agentStore),
    }));

    vi.doMock('../../electron/services/channels/store-instance', () => ({
      getGeeClawChannelStore: vi.fn(async () => channelStore),
    }));

    const configDir = join(homeDir, '.openclaw-geeclaw');
    const configPath = join(configDir, 'openclaw.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      agents: {
        defaults: {
          workspace: '/managed/workspace',
        },
      },
      channels: {
        wecom: {
          enabled: true,
          accounts: {
            default: {
              enabled: true,
            },
          },
        },
      },
      plugins: {
        allow: ['qqbot', 'openclaw-qqbot', 'other-plugin'],
        entries: {
          'openclaw-qqbot': {
            enabled: true,
          },
        },
      },
      skills: {
        entries: {
          existing: {
            enabled: true,
          },
        },
      },
    }, null, 2), 'utf8');

    agentStore.set('agents', {
      defaults: {
        workspace: '/managed/workspace',
        model: {
          primary: 'openrouter/model',
        },
      },
      list: [
        {
          id: 'main',
          name: 'Main',
          workspace: '/managed/workspace',
          agentDir: '~/.openclaw-geeclaw/agents/main/agent',
        },
        {
          id: 'helper',
          name: 'Helper',
          default: true,
          workspace: '~/.openclaw-geeclaw/workspace-helper',
          agentDir: '~/.openclaw-geeclaw/agents/helper/agent',
          avatarPresetId: 'gradient-rose',
          avatarSource: 'user',
        },
        {
          id: 'stockexpert',
          name: 'Stock Expert',
          workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
          agentDir: '~/.openclaw-geeclaw/agents/stockexpert/agent',
          skills: ['stock-analyzer'],
          avatarPresetId: 'gradient-sunset',
          avatarSource: 'default',
        },
      ],
    });
    agentStore.set('bindings', [
      {
        agentId: 'helper',
        match: {
          channel: 'wecom',
          accountId: 'default',
        },
      },
    ]);
    agentStore.set('management', {
      stockexpert: {
        agentId: 'stockexpert',
        source: 'preset',
        presetId: 'stock-expert',
        managed: true,
        lockedFields: ['id', 'workspace', 'persona'],
        canUnmanage: false,
        presetSkills: ['stock-analyzer'],
        managedFiles: ['AGENTS.md', 'SOUL.md'],
        installedAt: '2026-03-28T00:00:00.000Z',
      },
    });

    channelStore.set('channels', {
      wecom: {
        enabled: true,
        accounts: {
          default: {
            enabled: true,
          },
        },
      },
    });

    const { syncAllChannelConfigToOpenClaw } = await import('@electron/services/channels/channel-runtime-sync');
    await syncAllChannelConfigToOpenClaw();

    const storedAgentsAfterChannelSync = agentStore.get('agents') as {
      list?: Array<{ id: string }>;
    } | undefined;
    expect(storedAgentsAfterChannelSync?.list?.map((entry) => entry.id)).toContain('helper');

    const configAfterChannelSync = JSON.parse(readFileSync(configPath, 'utf8')) as {
      plugins?: {
        allow?: string[];
        entries?: Record<string, { enabled?: boolean }>;
      };
    };
    expect(configAfterChannelSync.plugins?.allow).toEqual(['qqbot', 'other-plugin', 'wecom-openclaw-plugin']);
    expect(configAfterChannelSync.plugins?.entries?.['openclaw-qqbot']).toBeUndefined();

    const { syncAllAgentConfigToOpenClaw } = await import('@electron/services/agents/agent-runtime-sync');
    await syncAllAgentConfigToOpenClaw();

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      agents?: {
        defaults?: {
          workspace?: string;
          model?: {
            primary?: string;
          };
        };
        list?: Array<{ id: string }>;
      };
      bindings?: Array<{ agentId?: string; match?: { channel?: string; accountId?: string } }>;
      channels?: {
        wecom?: {
          enabled?: boolean;
        };
      };
      plugins?: {
        allow?: string[];
        entries?: Record<string, { enabled?: boolean }>;
      };
      skills?: {
        entries?: Record<string, { enabled?: boolean }>;
      };
    };

    expect(config.agents?.defaults?.workspace).toBe('/managed/workspace');
    expect(config.agents?.defaults?.model?.primary).toBe('openrouter/model');
    expect(config.agents?.list?.map((entry) => entry.id)).toEqual(['main', 'helper', 'stockexpert']);
    expect(config.agents?.list?.find((entry) => entry.id === 'main')).not.toHaveProperty('workspace');
    expect(config.agents?.list?.find((entry) => entry.id === 'main')).not.toHaveProperty('agentDir');
    expect(config.agents?.list?.find((entry) => entry.id === 'helper')).not.toHaveProperty('agentDir');
    expect(config.agents?.list?.find((entry) => entry.id === 'stockexpert')).not.toHaveProperty('agentDir');
    expect(config.agents?.list?.find((entry) => entry.id === 'helper')).not.toHaveProperty('avatarPresetId');
    expect(config.agents?.list?.find((entry) => entry.id === 'helper')).not.toHaveProperty('avatarSource');
    expect(config.agents?.list?.find((entry) => entry.id === 'stockexpert')).not.toHaveProperty('avatarPresetId');
    expect(config.agents?.list?.find((entry) => entry.id === 'stockexpert')).not.toHaveProperty('avatarSource');
    expect(config.bindings).toEqual([
      {
        agentId: 'helper',
        match: {
          channel: 'wecom',
          accountId: 'default',
        },
      },
    ]);
    expect(config.channels?.wecom?.enabled).toBe(true);
    expect(config.plugins?.allow).toEqual(['qqbot', 'other-plugin', 'wecom-openclaw-plugin']);
    expect(config.plugins?.entries?.['openclaw-qqbot']).toBeUndefined();
    expect(config.skills?.entries?.existing?.enabled).toBe(true);
    expect(config.agents?.list?.find((entry) => entry.id === 'stockexpert')).not.toHaveProperty('managed');
    expect(JSON.stringify(config)).not.toContain('canUnmanage');
    expect(JSON.stringify(config)).not.toContain('managedFiles');
    expect(JSON.stringify(config)).not.toContain('presetId');
  });
});
