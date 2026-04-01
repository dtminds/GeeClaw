import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const originalPath = process.env.PATH;
const originalNotionApiKey = process.env.NOTION_API_KEY;

function setPlatform(platform: NodeJS.Platform): void {
  if (originalPlatformDescriptor && 'value' in originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', {
      ...originalPlatformDescriptor,
      value: platform,
      writable: true,
    });
    return;
  }

  Object.defineProperty(process, 'platform', {
    configurable: true,
    enumerable: true,
    value: platform,
    writable: true,
  });
}

function restorePlatform(): void {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
}

function getExpectedWorkspacePath(homeDir: string, agentId: string): string {
  return join(homeDir, 'geeclaw', agentId === 'main' ? 'workspace' : `workspace-${agentId}`);
}

async function setupManagedPresetFixture(options?: {
  presetMeta?: {
    name?: string;
    platforms?: Array<'darwin' | 'win32' | 'linux'>;
    requires?: {
      bins?: string[];
      anyBins?: string[];
      env?: string[];
    };
    managedPolicy?: {
      lockedFields?: Array<'id' | 'workspace' | 'persona'>;
      canUnmanage?: boolean;
    };
    agent?: {
      model?: string | { primary?: string; fallbacks?: string[] };
      skillScope?: { mode: 'default' } | { mode: 'specified'; skills: string[] };
    };
  };
  presetFiles?: Record<string, string>;
  mainWorkspaceFiles?: Record<string, string>;
  failAccessPaths?: string[] | ((homeDir: string) => string[]);
  managedAppEnv?: Record<string, string>;
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
  vi.doMock('fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const blockedList = typeof options?.failAccessPaths === 'function'
      ? options.failAccessPaths(homeDir)
      : (options?.failAccessPaths ?? []);
    const blockedPaths = new Set(blockedList.map((entry) => entry.replace(/\\/g, '/')));

    return {
      ...actual,
      default: actual,
      access: vi.fn(async (path: Parameters<typeof actual.access>[0], mode?: Parameters<typeof actual.access>[1]) => {
        const normalized = String(path).replace(/\\/g, '/');
        if (blockedPaths.has(normalized)) {
          throw new Error(`blocked access for ${normalized}`);
        }
        return actual.access(path, mode);
      }),
    };
  });
  vi.doMock('@electron/utils/paths', async () => {
    const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
    return {
      ...actual,
      getOpenClawConfigDir: () => join(homeDir, '.openclaw-geeclaw'),
      expandPath: (value: string) => value.startsWith('~')
        ? value.replace('~', homeDir)
        : value.startsWith('%USERPROFILE%')
          ? value.replace('%USERPROFILE%', homeDir)
        : value,
    };
  });
  const configDir = join(homeDir, '.openclaw-geeclaw');
  const mainWorkspaceDir = getExpectedWorkspacePath(homeDir, 'main');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(mainWorkspaceDir, { recursive: true });
  writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
    agents: { defaults: { workspace: getExpectedWorkspacePath(homeDir, 'main') } },
  }, null, 2), 'utf8');
  for (const [fileName, content] of Object.entries(options?.mainWorkspaceFiles ?? {})) {
    writeFileSync(join(mainWorkspaceDir, fileName), content, 'utf8');
  }

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

  vi.doMock('@electron/utils/app-env', () => ({
    resolveGeeClawAppEnvironment: vi.fn(async (baseEnv?: Record<string, string | undefined>) => ({
      ...(baseEnv ?? process.env),
      ...(options?.managedAppEnv ?? {}),
    })),
  }));

  const baseMeta = {
    presetId: 'stock-expert',
    name: '股票助手',
    description: 'desc',
    emoji: '📈',
    category: 'finance',
    managed: true,
    requires: undefined as { bins?: string[]; anyBins?: string[]; env?: string[] } | undefined,
    agent: {
      id: 'stockexpert',
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
    files: options?.presetFiles ?? {
      'AGENTS.md': '# stock expert\n',
      'SOUL.md': '# tone\n',
    },
    skills: {
      'stock-analyzer': {
        'SKILL.md': '# Stock Analyzer\nUse this skill for stock analysis.\n',
      },
      'web-search': {
        'SKILL.md': '# Web Search\nUse this skill for current information.\n',
        'README.md': '# Web Search docs\n',
      },
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
  restorePlatform();
  process.env.PATH = originalPath;
  if (originalNotionApiKey === undefined) {
    delete process.env.NOTION_API_KEY;
  } else {
    process.env.NOTION_API_KEY = originalNotionApiKey;
  }
  vi.resetModules();
  vi.unmock('electron');
  vi.unmock('os');
  vi.unmock('@electron/utils/paths');
  vi.unmock('fs/promises');
  vi.unmock('@electron/services/agents/store-instance');
  vi.unmock('@electron/utils/agent-presets');
  vi.unmock('@electron/utils/app-env');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('managed agent config domain', () => {
  it('reports preset summary platforms and current platform support', async () => {
    const { agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        platforms: ['darwin'],
      },
    });

    setPlatform('darwin');
    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        presetId: 'stock-expert',
        emoji: '📈',
        platforms: ['darwin'],
        installable: true,
        supportedOnCurrentPlatform: true,
      }),
    ]);

    setPlatform('win32');
    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        presetId: 'stock-expert',
        emoji: '📈',
        platforms: ['darwin'],
        installable: false,
        supportedOnCurrentPlatform: false,
      }),
    ]);
  });

  it('reports missing preset requirements in preset summaries', async () => {
    delete process.env.NOTION_API_KEY;
    process.env.PATH = '/tmp/geeclaw-empty-bin';

    const { agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        requires: {
          bins: ['preset-required-bin'],
          anyBins: ['missing-python3', 'missing-python'],
          env: ['NOTION_API_KEY'],
        },
      },
    });

    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        presetId: 'stock-expert',
        installable: false,
        supportedOnCurrentPlatform: true,
        missingRequirements: {
          bins: ['preset-required-bin'],
          anyBins: ['missing-python3', 'missing-python'],
          env: ['NOTION_API_KEY'],
        },
      }),
    ]);
  });

  it('treats anyBins as satisfied when at least one command exists', async () => {
    process.env.PATH = '/usr/bin:/bin';

    const { agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        requires: {
          anyBins: ['definitely-missing-command', 'sh'],
        },
      },
    });

    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        presetId: 'stock-expert',
        installable: true,
        missingRequirements: undefined,
      }),
    ]);
  });

  it('installs a preset agent, seeds managed files, writes skills into agents.list, and copies preset skills into workspace/skills', async () => {
    const { homeDir, configDir, agentConfig } = await setupManagedPresetFixture();
    const snapshot = await agentConfig.installPresetAgent('stock-expert');

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; skills?: string[]; agentDir?: string }> };
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
    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')).not.toHaveProperty('agentDir');
    expect(readFileSync(join(homeDir, 'geeclaw', 'workspace-stockexpert', 'AGENTS.md'), 'utf8')).toContain('stock expert');
    expect(readFileSync(join(homeDir, 'geeclaw', 'workspace-stockexpert', 'skills', 'stock-analyzer', 'SKILL.md'), 'utf8')).toContain('Stock Analyzer');
    expect(readFileSync(join(homeDir, 'geeclaw', 'workspace-stockexpert', 'skills', 'web-search', 'README.md'), 'utf8')).toContain('Web Search docs');
    expect(readdirSync(join(homeDir, 'geeclaw', 'workspace-stockexpert'))).toContain('skills');
    expect(readdirSync(join(homeDir, 'geeclaw', 'workspace-stockexpert'))).not.toContain('SKILLS');
    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      workspace: '~/geeclaw/workspace-stockexpert',
      agentDir: '~/.openclaw-geeclaw/agents/stockexpert/agent',
    });
  });

  it('copies main agent bootstrap files first, then overwrites only preset-declared files', async () => {
    const { homeDir, agentConfig } = await setupManagedPresetFixture({
      presetFiles: {
        'SOUL.md': '# preset tone\n',
        'IDENTITY.md': '# preset identity\n',
      },
      mainWorkspaceFiles: {
        'USER.md': '# main user\n',
        'SOUL.md': '# main tone\n',
        'IDENTITY.md': '# main identity\n',
        'MEMORY.md': '# main memory\n',
      },
    });

    await agentConfig.installPresetAgent('stock-expert');

    const workspaceDir = join(homeDir, 'geeclaw', 'workspace-stockexpert');
    expect(readFileSync(join(workspaceDir, 'USER.md'), 'utf8')).toBe('# main user\n');
    expect(readFileSync(join(workspaceDir, 'MEMORY.md'), 'utf8')).toBe('# main memory\n');
    expect(readFileSync(join(workspaceDir, 'SOUL.md'), 'utf8')).toBe('# preset tone\n');
    expect(readFileSync(join(workspaceDir, 'IDENTITY.md'), 'utf8')).toBe('# preset identity\n');
  });

  it('appends preset AGENTS.md after the copied workspace AGENTS.md content', async () => {
    const { homeDir, agentConfig } = await setupManagedPresetFixture({
      presetFiles: {
        'AGENTS.md': '# preset agent\n\nPreset instructions\n',
      },
      mainWorkspaceFiles: {
        'AGENTS.md': '# main agent\n\nMain instructions\n',
      },
    });

    await agentConfig.installPresetAgent('stock-expert');

    const content = readFileSync(join(homeDir, 'geeclaw', 'workspace-stockexpert', 'AGENTS.md'), 'utf8');
    expect(content).toContain('Main instructions');
    expect(content).toContain('Preset instructions');
    expect(content).toContain('<!-- preset_agent_instruction:begin -->');
    expect(content).toContain('<!-- preset_agent_instruction:end -->');
    expect(content).not.toContain('<!-- geeclaw:begin -->');
    expect(content.indexOf('Main instructions')).toBeLessThan(content.indexOf('Preset instructions'));
  });

  it('installs preset agents even when direct access probes on the workspace root fail', async () => {
    const { agentConfig } = await setupManagedPresetFixture({
      failAccessPaths: (homeDir) => [join(homeDir, 'geeclaw', 'workspace-stockexpert')],
    });

    await expect(agentConfig.installPresetAgent('stock-expert')).resolves.toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({ id: 'stockexpert', managed: true }),
      ]),
    });
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
    const { agentConfig, homeDir } = await setupManagedPresetFixture();
    await agentConfig.installPresetAgent('stock-expert');

    const snapshot = await agentConfig.unmanageAgent('stockexpert');

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      managed: false,
      presetSkills: [],
      managedFiles: [],
      canUseDefaultSkillScope: true,
    });
    expect(readFileSync(join(homeDir, 'geeclaw', 'workspace-stockexpert', 'skills', 'stock-analyzer', 'SKILL.md'), 'utf8')).toContain('Stock Analyzer');
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
    const { agentConfig, homeDir, configDir } = await setupManagedPresetFixture({
      presetMeta: {
        platforms: ['darwin'],
      },
    });
    const workspaceDir = join(homeDir, 'geeclaw', 'workspace-stockexpert');

    await expect(agentConfig.installPresetAgent('stock-expert')).rejects.toThrow(
      'Preset "stock-expert" is only available on macOS',
    );

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string }> };
    };

    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')).toBeUndefined();
    expect(existsSync(workspaceDir)).toBe(false);
  });

  it('rejects installing presets when required dependencies are missing', async () => {
    delete process.env.NOTION_API_KEY;
    const { agentConfig, homeDir, configDir } = await setupManagedPresetFixture({
      presetMeta: {
        requires: {
          anyBins: ['missing-candidate', 'sh'],
          env: ['NOTION_API_KEY'],
        },
      },
    });
    const workspaceDir = join(homeDir, 'geeclaw', 'workspace-stockexpert');

    await expect(agentConfig.installPresetAgent('stock-expert')).rejects.toThrow(
      'Preset "stock-expert" is missing required environment variables: NOTION_API_KEY',
    );

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string }> };
    };

    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')).toBeUndefined();
    expect(existsSync(workspaceDir)).toBe(false);
  });

  it('accepts preset env requirements from GeeClaw managed app environment', async () => {
    delete process.env.NOTION_API_KEY;
    const { agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        requires: {
          env: ['NOTION_API_KEY'],
        },
      },
      managedAppEnv: {
        NOTION_API_KEY: 'managed-secret',
      },
    });

    await expect(agentConfig.installPresetAgent('stock-expert')).resolves.toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({ id: 'stockexpert', managed: true }),
      ]),
    });
  });

  it('rejects installing presets when no anyBins candidate is available', async () => {
    process.env.PATH = '/tmp/geeclaw-empty-bin';
    const { agentConfig, homeDir, configDir } = await setupManagedPresetFixture({
      presetMeta: {
        requires: {
          anyBins: ['missing-python3', 'missing-python'],
        },
      },
    });
    const workspaceDir = join(homeDir, 'geeclaw', 'workspace-stockexpert');

    await expect(agentConfig.installPresetAgent('stock-expert')).rejects.toThrow(
      'Preset "stock-expert" requires one of these binaries: missing-python3, missing-python',
    );

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string }> };
    };

    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')).toBeUndefined();
    expect(existsSync(workspaceDir)).toBe(false);
  });

  it('creates and deletes custom agents under the managed geeclaw workspace root', async () => {
    const { homeDir, configDir, agentConfig } = await setupManagedPresetFixture();

    const created = await agentConfig.createAgent('Research Helper', 'research-helper');
    expect(created.agents.find((agent) => agent.id === 'research-helper')).toMatchObject({
      workspace: '~/geeclaw/workspace-research-helper',
      agentDir: '~/.openclaw-geeclaw/agents/research-helper/agent',
    });
    const configAfterCreate = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: {
        defaults?: { workspace?: string };
        list?: Array<{ id?: string; workspace?: string; agentDir?: string }>;
      };
    };
    expect(configAfterCreate.agents?.defaults?.workspace).toBe(getExpectedWorkspacePath(homeDir, 'main'));
    expect(configAfterCreate.agents?.list?.find((agent) => agent.id === 'main')).not.toHaveProperty('workspace');
    expect(configAfterCreate.agents?.list?.find((agent) => agent.id === 'main')).not.toHaveProperty('agentDir');
    expect(configAfterCreate.agents?.list?.find((agent) => agent.id === 'research-helper')).not.toHaveProperty('agentDir');
    expect(existsSync(join(homeDir, 'geeclaw', 'workspace-research-helper'))).toBe(true);

    await agentConfig.deleteAgentConfig('research-helper');
    expect(existsSync(join(homeDir, 'geeclaw', 'workspace-research-helper'))).toBe(false);
  });

  it('uses %USERPROFILE%-based workspace defaults on Windows', async () => {
    setPlatform('win32');
    const { agentConfig } = await setupManagedPresetFixture();

    const created = await agentConfig.createAgent('Windows Helper', 'windows-helper');
    expect(created.agents.find((agent) => agent.id === 'windows-helper')).toMatchObject({
      workspace: '%USERPROFILE%\\geeclaw\\workspace-windows-helper',
      agentDir: '~/.openclaw-geeclaw/agents/windows-helper/agent',
    });
  });
});
