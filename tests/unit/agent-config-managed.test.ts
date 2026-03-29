import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

async function setupManagedPresetFixture(options?: {
  presetMeta?: {
    name?: string;
    platforms?: Array<'darwin' | 'win32' | 'linux'>;
    managedPolicy?: {
      lockedFields?: Array<'id' | 'workspace' | 'persona'>;
      canUnmanage?: boolean;
    };
    agent?: {
      model?: string | { primary?: string; fallbacks?: string[] };
      skillScope?: { mode: 'default' } | { mode: 'specified'; skills: string[] };
    };
  };
}) {
  const homeDir = mkdtempSync(join(tmpdir(), 'managed-agent-install-'));
  tempDirs.push(homeDir);

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
    default: { homedir: () => homeDir },
  }));
  vi.doMock('@electron/utils/paths', async () => {
    const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
    return {
      ...actual,
      getOpenClawConfigDir: () => join(homeDir, '.openclaw-geeclaw'),
      expandPath: (value: string) => value.startsWith('~')
        ? value.replace('~', homeDir)
        : value,
    };
  });

  const configDir = join(homeDir, '.openclaw-geeclaw');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
    agents: { defaults: { workspace: join(configDir, 'workspace') } },
  }, null, 2), 'utf8');

  const storeState: Record<string, unknown> = {};
  vi.doMock('@electron/services/agents/store-instance', () => ({
    getGeeClawAgentStore: vi.fn(async () => ({
      get: (key: string) => storeState[key],
      set: (key: string, value: unknown) => {
        storeState[key] = JSON.parse(JSON.stringify(value));
      },
      delete: (key: string) => {
        delete storeState[key];
      },
    })),
  }));

  const baseMeta = {
    presetId: 'stock-expert',
    name: '股票助手',
    description: 'desc',
    iconKey: 'stock',
    category: 'finance',
    managed: true,
    agent: {
      id: 'stockexpert',
      workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
      skillScope: {
        mode: 'specified' as const,
        skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
      },
    },
    managedPolicy: {
      lockedFields: ['id', 'workspace', 'persona'] as Array<'id' | 'workspace' | 'persona'>,
      canUnmanage: true,
    },
  };
  const presetMeta = {
    ...baseMeta,
    ...options?.presetMeta,
    agent: {
      ...baseMeta.agent,
      ...options?.presetMeta?.agent,
      skillScope: options?.presetMeta?.agent?.skillScope ?? baseMeta.agent.skillScope,
    },
    managedPolicy: options?.presetMeta?.managedPolicy === undefined
      ? baseMeta.managedPolicy
      : options.presetMeta.managedPolicy,
  };
  const presetPackage = {
    meta: presetMeta,
    files: {
      'AGENTS.md': '# stock expert\n',
      'SOUL.md': '# tone\n',
    },
  };

  vi.doMock('@electron/utils/agent-presets', () => ({
    getAgentPreset: vi.fn(async () => presetPackage),
    listAgentPresets: vi.fn(async () => [presetPackage]),
  }));

  const agentConfig = await import('@electron/utils/agent-config');
  return { homeDir, configDir, storeState, agentConfig };
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  vi.resetModules();
  vi.unmock('electron');
  vi.unmock('os');
  vi.unmock('@electron/utils/paths');
  vi.unmock('@electron/services/agents/store-instance');
  vi.unmock('@electron/utils/agent-presets');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('managed agent config domain', () => {
  it('reports preset summary platforms and current platform support', async () => {
    setPlatform('darwin');
    const { agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        platforms: ['darwin'],
      },
    });

    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        presetId: 'stock-expert',
        platforms: ['darwin'],
        supportedOnCurrentPlatform: true,
      }),
    ]);
  });

  it('installs a preset agent, seeds managed files, and writes skills into agents.list', async () => {
    const { configDir, agentConfig } = await setupManagedPresetFixture();
    const snapshot = await agentConfig.installPresetAgent('stock-expert');

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; skills?: string[] }> };
    };

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      managed: true,
      source: 'preset',
      presetId: 'stock-expert',
      presetSkills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
      managedFiles: ['AGENTS.md', 'SOUL.md'],
      canUseDefaultSkillScope: false,
    });
    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')?.skills).toEqual([
      'stock-analyzer',
      'stock-announcements',
      'stock-explorer',
      'web-search',
    ]);
    expect(readFileSync(join(configDir, 'workspace-stockexpert', 'AGENTS.md'), 'utf8')).toContain('stock expert');
  });

  it('preserves preset model config on the installed agent entry', async () => {
    const { configDir, agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        agent: {
          model: {
            primary: 'openrouter/stock-pro',
            fallbacks: ['openrouter/stock-lite'],
          },
        },
      },
    });

    const snapshot = await agentConfig.installPresetAgent('stock-expert');
    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: {
        list?: Array<{
          id?: string;
          model?: {
            primary?: string;
            fallbacks?: string[];
          };
        }>;
      };
    };

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      modelDisplay: 'stock-pro',
    });
    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')?.model).toEqual({
      primary: 'openrouter/stock-pro',
      fallbacks: ['openrouter/stock-lite'],
    });
  });

  it('clears active managed restrictions after unmanage', async () => {
    const { agentConfig } = await setupManagedPresetFixture();
    await agentConfig.installPresetAgent('stock-expert');

    const snapshot = await agentConfig.unmanageAgent('stockexpert');

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      managed: false,
      presetSkills: [],
      managedFiles: [],
      canUseDefaultSkillScope: true,
    });
  });

  it('allows managed agents to edit user, memory, and soul files while keeping identity locked', async () => {
    const { agentConfig } = await setupManagedPresetFixture();
    await agentConfig.installPresetAgent('stock-expert');

    await expect(agentConfig.updateAgentPersona('stockexpert', {
      identity: '# updated identity\n',
    })).rejects.toThrow('cannot edit locked persona files: identity');

    await expect(agentConfig.updateAgentPersona('stockexpert', {
      master: '# updated user\n',
      memory: '# updated memory\n',
      soul: '# updated tone\n',
    })).resolves.toMatchObject({
      editable: true,
      lockedFiles: ['identity'],
      files: {
        master: {
          exists: true,
          content: '# updated user\n',
        },
        memory: {
          exists: true,
          content: '# updated memory\n',
        },
        soul: {
          exists: true,
          content: '# updated tone\n',
        },
      },
    });

    const snapshot = await agentConfig.getAgentPersona('stockexpert');
    expect(snapshot).toMatchObject({
      editable: true,
      lockedFiles: ['identity'],
    });
  });

  it('respects preset managed policy for persona locks and unmanage permission', async () => {
    const { agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        managedPolicy: {
          lockedFields: ['id', 'workspace'],
          canUnmanage: false,
        },
      },
    });
    const installed = await agentConfig.installPresetAgent('stock-expert');

    expect(installed.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      lockedFields: ['id', 'workspace'],
      canUnmanage: false,
      managed: true,
    });

    await expect(agentConfig.updateAgentPersona('stockexpert', {
      soul: '# updated tone\n',
    })).resolves.toMatchObject({
      editable: true,
      lockedFiles: [],
      files: {
        soul: {
          exists: true,
          content: '# updated tone\n',
        },
      },
    });

    await expect(agentConfig.unmanageAgent('stockexpert')).rejects.toThrow('cannot be unmanaged');
  });

  it('rejects empty specified skill scopes in settings updates', async () => {
    const { agentConfig } = await setupManagedPresetFixture();
    await agentConfig.installPresetAgent('stock-expert');
    await agentConfig.unmanageAgent('stockexpert');

    await expect(agentConfig.updateAgentSettings('stockexpert', {
      skillScope: {
        mode: 'specified',
        skills: [],
      },
    })).rejects.toThrow('must contain at least 1 skill');
  });

  it('blocks removing preset skills while the agent remains managed', async () => {
    const { validateManagedSkillScope } = await import('@electron/utils/agent-config');

    expect(() => validateManagedSkillScope(
      ['stock-analyzer', 'stock-announcements'],
      { mode: 'specified', skills: ['stock-analyzer'] },
    )).toThrow('cannot remove preset-defined skills');
  });

  it('allows switching to default only after unmanage clears presetSkills', async () => {
    const { validateManagedSkillScope } = await import('@electron/utils/agent-config');

    expect(() => validateManagedSkillScope(
      ['stock-analyzer'],
      { mode: 'default' },
    )).toThrow('cannot use the default skill scope');

    expect(() => validateManagedSkillScope(
      [],
      { mode: 'default' },
    )).not.toThrow();
  });

  it('rejects installing presets that are unsupported on the current platform', async () => {
    setPlatform('win32');
    const { agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        platforms: ['darwin'],
      },
    });

    await expect(agentConfig.installPresetAgent('stock-expert')).rejects.toThrow(
      'Preset "stock-expert" is only available on macOS',
    );
  });
});
