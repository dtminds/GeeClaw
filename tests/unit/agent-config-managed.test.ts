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
  marketplacePackage?: {
    catalogEntry?: {
      agentId?: string;
      name?: string;
      description?: string;
      emoji?: string;
      category?: string;
      version?: string;
      downloadUrl?: string;
      checksum?: string;
      platforms?: Array<'darwin' | 'win32' | 'linux'>;
    };
    meta?: {
      name?: string;
      description?: string;
      emoji?: string;
      category?: string;
      packageVersion?: string;
      postInstallPrompt?: string;
      postUpdatePrompt?: string;
      managedPolicy?: {
        lockedFields?: Array<'id' | 'workspace' | 'persona'>;
        canUnmanage?: boolean;
      };
      agent?: {
        id?: string;
        model?: string | { primary?: string; fallbacks?: string[] };
        skillScope?: { mode: 'default' } | { mode: 'specified'; skills: string[] };
      };
    };
    files?: Record<string, string>;
    skills?: Record<string, Record<string, string>>;
  };
  providerAccounts?: Record<string, {
    id: string;
    vendorId: string;
    label: string;
    authMode: 'api_key' | 'oauth_device' | 'oauth_browser' | 'local';
    apiProtocol?: string;
    baseUrl?: string;
    models?: string[];
    model?: string;
    fallbackModels?: string[];
    fallbackAccountIds?: string[];
    metadata?: {
      modelCatalog?: {
        disabledBuiltinModelIds?: string[];
        disabledCustomModelIds?: string[];
        customModels?: Array<string | { id: string; name?: string; reasoning?: boolean; input?: Array<'text' | 'image'>; contextWindow?: number; maxTokens?: number }>;
        builtinModelOverrides?: Array<string | { id: string; name?: string; reasoning?: boolean; input?: Array<'text' | 'image'>; contextWindow?: number; maxTokens?: number }>;
      };
    };
    enabled: boolean;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  defaultProviderAccountId?: string;
}) {
  const homeDir = mkdtempSync(join(tmpdir(), 'managed-agent-install-'));
  tempDirs.push(homeDir);
  const deleteDesktopSessionsForAgent = vi.fn(async () => []);

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
  vi.doMock('@electron/utils/paths', () => ({
    getOpenClawConfigDir: () => join(homeDir, '.openclaw-geeclaw'),
    getOpenClawResolvedDir: () => '/tmp/openclaw',
    getOpenClawSkillsDir: () => join(homeDir, '.openclaw-geeclaw', 'skills'),
    getGeeClawConfigDir: () => join(homeDir, '.geeclaw'),
    getLogsDir: () => join(homeDir, '.geeclaw', 'logs'),
    getDataDir: () => join(homeDir, '.geeclaw'),
    getResourcesDir: () => '/tmp/geeclaw-test-app/resources',
    getOpenClawDir: () => '/tmp/openclaw',
    getOpenClawEntryPath: () => '/tmp/openclaw/openclaw.mjs',
    getClawHubCliEntryPath: () => '/tmp/geeclaw-test-app/node_modules/clawhub/bin/clawdhub.js',
    getClawHubCliBinPath: () => '/tmp/geeclaw-test-app/node_modules/.bin/clawhub',
    isOpenClawPresent: () => true,
    isOpenClawBuilt: () => true,
    getOpenClawStatus: () => ({
      packageExists: true,
      isBuilt: true,
      entryPath: '/tmp/openclaw/openclaw.mjs',
      dir: '/tmp/openclaw',
    }),
    ensureDir: vi.fn(),
    expandPath: (value: string) => value.startsWith('~')
      ? value.replace('~', homeDir)
      : value.startsWith('%USERPROFILE%')
        ? value.replace('%USERPROFILE%', homeDir)
      : value,
  }));
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
  const providerStoreState: Record<string, unknown> = {
    providerAccounts: options?.providerAccounts ?? {},
    defaultProviderAccountId: options?.defaultProviderAccountId,
  };
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
  vi.doMock('@electron/services/providers/store-instance', () => ({
    getGeeClawProviderStore: vi.fn(async () => ({
      get: (key: string) => providerStoreState[key],
      set: (key: string, value: unknown) => {
        providerStoreState[key] = JSON.parse(JSON.stringify(value));
      },
      delete: (key: string) => {
        delete providerStoreState[key];
      },
    })),
  }));

  vi.doMock('@electron/utils/desktop-sessions', () => ({
    deleteDesktopSessionsForAgent,
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

  const marketplaceCatalogEntry = {
    agentId: 'stockexpert',
    name: '股票助手',
    description: 'desc',
    emoji: '📈',
    category: 'finance',
    version: '1.2.3',
    downloadUrl: 'https://example.com/stockexpert-1.2.3.zip',
    checksum: `sha256-${'1'.repeat(64)}`,
    ...options?.marketplacePackage?.catalogEntry,
  };
  const marketplaceMetaAgent = {
    id: marketplaceCatalogEntry.agentId,
    skillScope: {
      mode: 'specified' as const,
      skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
    },
    ...options?.marketplacePackage?.meta?.agent,
  };
  const marketplaceManagedPolicy = options?.marketplacePackage?.meta?.managedPolicy === undefined
    ? {
        lockedFields: ['id', 'workspace', 'persona'] as Array<'id' | 'workspace' | 'persona'>,
        canUnmanage: true,
      }
    : options.marketplacePackage.meta.managedPolicy;
  const marketplacePackage = {
    meta: {
      presetId: 'stockexpert',
      name: marketplaceCatalogEntry.name,
      description: marketplaceCatalogEntry.description,
      emoji: marketplaceCatalogEntry.emoji,
      category: marketplaceCatalogEntry.category,
      managed: true,
      packageVersion: marketplaceCatalogEntry.version,
      postInstallPrompt: 'Please review the installed workspace.',
      postUpdatePrompt: 'Please summarize what changed.',
      ...options?.marketplacePackage?.meta,
      agent: marketplaceMetaAgent,
      managedPolicy: marketplaceManagedPolicy,
    },
    files: options?.marketplacePackage?.files ?? {
      'AGENTS.md': '# stock expert\n',
      'SOUL.md': '# tone\n',
    },
    skills: options?.marketplacePackage?.skills ?? {
      'stock-analyzer': {
        'SKILL.md': '# Stock Analyzer\nUse this skill for stock analysis.\n',
      },
      'web-search': {
        'SKILL.md': '# Web Search\nUse this skill for current information.\n',
        'README.md': '# Web Search docs\n',
      },
    },
  };
  const marketplaceState = {
    preparedPackage: {
      catalogEntry: marketplaceCatalogEntry,
      package: marketplacePackage,
    },
  };

  vi.doMock('@electron/utils/agent-presets', () => ({
    getAgentPreset: vi.fn(async () => presetPackage),
    listAgentPresets: vi.fn(async () => [presetPackage]),
  }));
  vi.doMock('@electron/utils/agent-marketplace-installer', () => ({
    getAgentMarketplaceCatalogEntry: vi.fn(async (agentId: string) => {
      if (agentId !== marketplaceState.preparedPackage.catalogEntry.agentId) {
        throw new Error(`Unknown marketplace agent "${agentId}"`);
      }

      return marketplaceState.preparedPackage.catalogEntry;
    }),
    prepareAgentMarketplacePackage: vi.fn(async (catalogEntry: { agentId: string }) => {
      if (catalogEntry.agentId !== marketplaceState.preparedPackage.catalogEntry.agentId) {
        throw new Error(`Unknown marketplace agent "${catalogEntry.agentId}"`);
      }

      return {
        catalogEntry: marketplaceState.preparedPackage.catalogEntry,
        package: marketplaceState.preparedPackage.package,
        cleanup: vi.fn(async () => undefined),
      };
    }),
  }));
  vi.doMock('@electron/utils/agent-marketplace-catalog', () => ({
    loadAgentMarketplaceCatalog: vi.fn(async () => [
      marketplaceState.preparedPackage.catalogEntry,
    ]),
  }));

  const agentConfig = await import('@electron/utils/agent-config');
  return {
    homeDir,
    configDir,
    storeState,
    providerStoreState,
    agentConfig,
    deleteDesktopSessionsForAgent,
    marketplaceState,
  };
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
  vi.unmock('@electron/utils/desktop-sessions');
  vi.unmock('@electron/utils/agent-presets');
  vi.unmock('@electron/utils/agent-marketplace-installer');
  vi.unmock('@electron/utils/app-env');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('managed agent config domain', () => {
  it('reports preset summary platforms and current platform support', async () => {
    const { agentConfig } = await setupManagedPresetFixture({
      marketplacePackage: {
        catalogEntry: {
          platforms: ['darwin'],
        },
      },
      presetMeta: {
        platforms: ['darwin'],
      },
    });

    setPlatform('darwin');
    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        source: 'marketplace',
        agentId: 'stockexpert',
        emoji: '📈',
        latestVersion: '1.2.3',
        installed: false,
        installedVersion: undefined,
        hasUpdate: false,
        platforms: ['darwin'],
        installable: true,
        supportedOnCurrentPlatform: true,
        supportedOnCurrentAppVersion: true,
      }),
    ]);

    setPlatform('win32');
    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        source: 'marketplace',
        agentId: 'stockexpert',
        emoji: '📈',
        latestVersion: '1.2.3',
        installed: false,
        hasUpdate: false,
        platforms: ['darwin'],
        installable: false,
        supportedOnCurrentPlatform: false,
        supportedOnCurrentAppVersion: true,
      }),
    ]);
  });

  it('does not derive marketplace summary requirements from bundled preset metadata', async () => {
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
        source: 'marketplace',
        agentId: 'stockexpert',
        installable: true,
        supportedOnCurrentPlatform: true,
        supportedOnCurrentAppVersion: true,
      }),
    ]);
  });

  it('reports marketplace summary skills from catalog metadata', async () => {
    const { agentConfig } = await setupManagedPresetFixture({
      presetMeta: {
        agent: {
          skillScope: {
            mode: 'specified',
            skills: ['preset-only-skill'],
          },
        },
      },
      marketplacePackage: {
        catalogEntry: {
          presetSkills: ['catalog-skill-a', 'catalog-skill-b'],
        },
      },
    });

    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        source: 'marketplace',
        agentId: 'stockexpert',
        skillScope: {
          mode: 'specified',
          skills: ['catalog-skill-a', 'catalog-skill-b'],
        },
        presetSkills: ['catalog-skill-a', 'catalog-skill-b'],
        managedFiles: [],
      }),
    ]);
  });

  it('marks marketplace agents as installed when config entries or runtime directories exist without management metadata', async () => {
    const { agentConfig, configDir, homeDir, storeState } = await setupManagedPresetFixture();

    await agentConfig.installMarketplaceAgent('stockexpert');
    delete storeState.management;

    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        source: 'marketplace',
        agentId: 'stockexpert',
        installed: true,
        installedVersion: undefined,
        hasUpdate: false,
      }),
    ]);

    rmSync(join(homeDir, '.openclaw-geeclaw', 'agents', 'stockexpert'), { recursive: true, force: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace: getExpectedWorkspacePath(homeDir, 'main') },
      },
    }, null, 2), 'utf8');

    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        source: 'marketplace',
        agentId: 'stockexpert',
        installed: false,
        installedVersion: undefined,
        hasUpdate: false,
      }),
    ]);
  });

  it('reports installed marketplace versions and update availability from management state', async () => {
    const { agentConfig, marketplaceState } = await setupManagedPresetFixture();

    await agentConfig.installMarketplaceAgent('stockexpert');
    marketplaceState.preparedPackage.catalogEntry = {
      ...marketplaceState.preparedPackage.catalogEntry,
      version: '1.2.4',
      downloadUrl: 'https://example.com/stockexpert-1.2.4.zip',
    };

    await expect(agentConfig.listAgentPresetSummaries()).resolves.toEqual([
      expect.objectContaining({
        source: 'marketplace',
        agentId: 'stockexpert',
        latestVersion: '1.2.4',
        installed: true,
        installedVersion: '1.2.3',
        hasUpdate: true,
      }),
    ]);
  });

  it('installs a marketplace agent, seeds managed files, writes skills into agents.list, and copies preset skills into workspace/skills', async () => {
    const { homeDir, configDir, agentConfig } = await setupManagedPresetFixture();
    const snapshot = await agentConfig.installMarketplaceAgent('stockexpert');

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; skills?: string[]; agentDir?: string }> };
    };

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      managed: true,
      source: 'marketplace',
      manualSkills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
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

  it('installs a marketplace agent, returns completion metadata, and persists managed package metadata', async () => {
    const { agentConfig, storeState } = await setupManagedPresetFixture();

    const result = await agentConfig.installMarketplaceAgent('stockexpert');

    expect(result).toMatchObject({
      completion: {
        operation: 'install',
        agentId: 'stockexpert',
        promptText: 'Please review the installed workspace.',
      },
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: 'stockexpert',
          managed: true,
          managedFiles: ['AGENTS.md', 'SOUL.md'],
          presetSkills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
          avatarPresetId: 'gradient-sunset',
          avatarSource: 'default',
        }),
      ]),
    });

    expect(storeState.management).toMatchObject({
      stockexpert: {
        agentId: 'stockexpert',
        source: 'marketplace',
        managed: true,
        packageVersion: '1.2.3',
        sourceDownloadUrl: 'https://example.com/stockexpert-1.2.3.zip',
        managedFiles: ['AGENTS.md', 'SOUL.md'],
        managedSkills: ['stock-analyzer', 'web-search'],
        installedAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
    const management = storeState.management as Record<string, {
      installedAt: string;
      updatedAt: string;
    }>;
    expect(management.stockexpert.installedAt).toBe(management.stockexpert.updatedAt);
  });

  it('normalizes legacy managed metadata without source before building snapshots', async () => {
    const { agentConfig, storeState } = await setupManagedPresetFixture();

    await agentConfig.installMarketplaceAgent('stockexpert');
    const management = storeState.management as Record<string, Record<string, unknown>>;
    delete management.stockexpert.source;

    const snapshot = await agentConfig.listAgentsSnapshot();

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      managed: true,
      source: 'preset',
      managementSource: 'preset',
    });
  });

  it('updates marketplace agents in place, preserves workspace paths, and only reapplies managed content', async () => {
    const { agentConfig, configDir, homeDir, storeState, marketplaceState } = await setupManagedPresetFixture();

    await agentConfig.installMarketplaceAgent('stockexpert');

    const customWorkspaceDir = join(homeDir, 'custom-stockexpert-workspace');
    mkdirSync(join(customWorkspaceDir, 'skills', 'stock-analyzer'), { recursive: true });
    mkdirSync(join(customWorkspaceDir, 'skills', 'local-only'), { recursive: true });
    writeFileSync(
      join(customWorkspaceDir, 'AGENTS.md'),
      [
        '# main agent',
        '',
        'Main instructions',
        '',
        '<!-- preset_agent_instruction:begin -->',
        '# stock expert',
        '<!-- preset_agent_instruction:end -->',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(customWorkspaceDir, 'SOUL.md'), '# previous tone\n', 'utf8');
    writeFileSync(join(customWorkspaceDir, 'NOTES.md'), 'keep me\n', 'utf8');
    writeFileSync(join(customWorkspaceDir, 'skills', 'stock-analyzer', 'SKILL.md'), '# Old Stock Analyzer\n', 'utf8');
    writeFileSync(join(customWorkspaceDir, 'skills', 'local-only', 'SKILL.md'), '# Local Only\n', 'utf8');

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; workspace?: string }> };
    };
    const targetEntry = config.agents?.list?.find((entry) => entry.id === 'stockexpert');
    if (!targetEntry) {
      throw new Error('Expected stockexpert entry to exist');
    }
    targetEntry.workspace = customWorkspaceDir;
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');

    marketplaceState.preparedPackage = {
      catalogEntry: {
        ...marketplaceState.preparedPackage.catalogEntry,
        version: '1.2.4',
        downloadUrl: 'https://example.com/stockexpert-1.2.4.zip',
      },
      package: {
        ...marketplaceState.preparedPackage.package,
        meta: {
          ...marketplaceState.preparedPackage.package.meta,
          packageVersion: '1.2.4',
          postUpdatePrompt: 'Please summarize the update before I continue.',
          agent: {
            id: 'stockexpert',
            skillScope: {
              mode: 'specified',
              skills: ['trend-scan', 'web-search'],
            },
          },
        },
        files: {
          'AGENTS.md': '# updated official agent\n\nUpdated instructions\n',
          'MEMORY.md': '# official memory\n',
        },
        skills: {
          'trend-scan': {
            'SKILL.md': '# Trend Scan\n',
          },
          'web-search': {
            'SKILL.md': '# Web Search v2\n',
          },
        },
      },
    };

    const result = await agentConfig.updateMarketplaceAgent('stockexpert');

    expect(result).toMatchObject({
      completion: {
        operation: 'update',
        agentId: 'stockexpert',
        promptText: 'Please summarize the update before I continue.',
      },
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: 'stockexpert',
          workspace: customWorkspaceDir,
          presetSkills: ['trend-scan', 'web-search'],
          managedFiles: ['AGENTS.md', 'MEMORY.md'],
        }),
      ]),
    });

    const updatedConfig = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; workspace?: string; skills?: string[] }> };
    };
    expect(updatedConfig.agents?.list?.find((entry) => entry.id === 'stockexpert')).toMatchObject({
      workspace: customWorkspaceDir,
      skills: ['trend-scan', 'web-search'],
    });
    expect(readFileSync(join(customWorkspaceDir, 'AGENTS.md'), 'utf8')).toContain('Updated instructions');
    expect(readFileSync(join(customWorkspaceDir, 'MEMORY.md'), 'utf8')).toBe('# official memory\n');
    expect(readFileSync(join(customWorkspaceDir, 'NOTES.md'), 'utf8')).toBe('keep me\n');
    expect(readFileSync(join(customWorkspaceDir, 'skills', 'trend-scan', 'SKILL.md'), 'utf8')).toContain('Trend Scan');
    expect(readFileSync(join(customWorkspaceDir, 'skills', 'local-only', 'SKILL.md'), 'utf8')).toContain('Local Only');
    expect(existsSync(join(customWorkspaceDir, 'skills', 'stock-analyzer'))).toBe(false);
    expect(existsSync(join(customWorkspaceDir, 'SOUL.md'))).toBe(false);

    expect(storeState.management).toMatchObject({
      stockexpert: {
        packageVersion: '1.2.4',
        sourceDownloadUrl: 'https://example.com/stockexpert-1.2.4.zip',
        managedFiles: ['AGENTS.md', 'MEMORY.md'],
        managedSkills: ['trend-scan', 'web-search'],
      },
    });
  });

  it('copies main agent bootstrap files first, then overwrites only preset-declared files', async () => {
    const { homeDir, agentConfig } = await setupManagedPresetFixture({
      marketplacePackage: {
        files: {
          'SOUL.md': '# preset tone\n',
          'IDENTITY.md': '# preset identity\n',
        },
      },
      mainWorkspaceFiles: {
        'USER.md': '# main user\n',
        'SOUL.md': '# main tone\n',
        'IDENTITY.md': '# main identity\n',
        'MEMORY.md': '# main memory\n',
      },
    });

    await agentConfig.installMarketplaceAgent('stockexpert');

    const workspaceDir = join(homeDir, 'geeclaw', 'workspace-stockexpert');
    expect(readFileSync(join(workspaceDir, 'USER.md'), 'utf8')).toBe('# main user\n');
    expect(readFileSync(join(workspaceDir, 'MEMORY.md'), 'utf8')).toBe('# main memory\n');
    expect(readFileSync(join(workspaceDir, 'SOUL.md'), 'utf8')).toBe('# preset tone\n');
    expect(readFileSync(join(workspaceDir, 'IDENTITY.md'), 'utf8')).toBe('# preset identity\n');
  });

  it('appends preset AGENTS.md after the copied workspace AGENTS.md content', async () => {
    const { homeDir, agentConfig } = await setupManagedPresetFixture({
      marketplacePackage: {
        files: {
          'AGENTS.md': '# preset agent\n\nPreset instructions\n',
        },
      },
      mainWorkspaceFiles: {
        'AGENTS.md': '# main agent\n\nMain instructions\n',
      },
    });

    await agentConfig.installMarketplaceAgent('stockexpert');

    const content = readFileSync(join(homeDir, 'geeclaw', 'workspace-stockexpert', 'AGENTS.md'), 'utf8');
    expect(content).toContain('Main instructions');
    expect(content).toContain('Preset instructions');
    expect(content).toContain('<!-- preset_agent_instruction:begin -->');
    expect(content).toContain('<!-- preset_agent_instruction:end -->');
    expect(content).not.toContain('<!-- geeclaw:begin -->');
    expect(content.indexOf('Main instructions')).toBeLessThan(content.indexOf('Preset instructions'));
  });

  it('installs marketplace agents even when direct access probes on the workspace root fail', async () => {
    const { agentConfig } = await setupManagedPresetFixture({
      failAccessPaths: (homeDir) => [join(homeDir, 'geeclaw', 'workspace-stockexpert')],
    });

    await expect(agentConfig.installMarketplaceAgent('stockexpert')).resolves.toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({ id: 'stockexpert', managed: true }),
      ]),
    });
  });

  it('preserves marketplace model config on the installed agent entry', async () => {
    const { configDir, agentConfig } = await setupManagedPresetFixture({
      marketplacePackage: {
        meta: {
          agent: {
          model: {
            primary: 'openrouter/stock-pro',
            fallbacks: ['openrouter/stock-lite'],
          },
        },
        },
      },
    });

    const snapshot = await agentConfig.installMarketplaceAgent('stockexpert');
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

  it('returns the expanded default model snapshot with auto-mode optional sections', async () => {
    const { configDir, homeDir, agentConfig } = await setupManagedPresetFixture({
      providerAccounts: {
        'openai-account': {
          id: 'openai-account',
          vendorId: 'openai',
          label: 'OpenAI',
          authMode: 'api_key',
          models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-image-1'],
          enabled: true,
          isDefault: true,
          createdAt: '2026-04-13T00:00:00.000Z',
          updatedAt: '2026-04-13T00:00:00.000Z',
        },
        'openrouter-account': {
          id: 'openrouter-account',
          vendorId: 'openrouter',
          label: 'OpenRouter',
          authMode: 'api_key',
          models: ['qwen/qwen-2.5-vl-72b-instruct:free'],
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-13T00:00:00.000Z',
          updatedAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: {
          workspace: getExpectedWorkspacePath(homeDir, 'main'),
          model: {
            primary: 'openai/gpt-5.4',
            fallbacks: ['openai/gpt-5.4-mini'],
          },
          imageGenerationModel: {
            primary: 'openai/gpt-image-1',
            fallbacks: [],
          },
        },
      },
    }, null, 2), 'utf8');

    await expect(agentConfig.getDefaultAgentModelConfig()).resolves.toMatchObject({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: ['openai/gpt-5.4-mini'],
      },
      imageModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      pdfModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: true,
        primary: 'openai/gpt-image-1',
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      availableModels: expect.arrayContaining([
        expect.objectContaining({
          providerId: 'openai-account',
          modelRefs: expect.arrayContaining([
            'openai/gpt-5.4',
            'openai/gpt-5.4-mini',
            'openai/gpt-image-1',
          ]),
        }),
      ]),
    });
  });

  it('writes explicit model refs, omits auto sections, and registers referenced defaults models', async () => {
    const { configDir, agentConfig } = await setupManagedPresetFixture({
      providerAccounts: {
        'openai-account': {
          id: 'openai-account',
          vendorId: 'openai',
          label: 'OpenAI',
          authMode: 'api_key',
          models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-image-1'],
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-13T00:00:00.000Z',
          updatedAt: '2026-04-13T00:00:00.000Z',
        },
        'openrouter-account': {
          id: 'openrouter-account',
          vendorId: 'openrouter',
          label: 'OpenRouter',
          authMode: 'api_key',
          models: ['qwen/qwen-2.5-vl-72b-instruct:free'],
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-13T00:00:00.000Z',
          updatedAt: '2026-04-13T00:00:00.000Z',
        },
        'qwen-account': {
          id: 'qwen-account',
          vendorId: 'qwen',
          label: 'Qwen',
          authMode: 'api_key',
          models: ['wan2.6-t2v'],
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-13T00:00:00.000Z',
          updatedAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    await expect(agentConfig.updateDefaultAgentModelConfig({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: ['openai/gpt-5.4-mini'],
      },
      imageModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      pdfModel: {
        configured: true,
        primary: 'openrouter/qwen/qwen-2.5-vl-72b-instruct:free',
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: true,
        primary: 'openai/gpt-image-1',
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
    })).resolves.toMatchObject({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: ['openai/gpt-5.4-mini'],
      },
      imageModel: {
        configured: false,
      },
      pdfModel: {
        configured: true,
        primary: 'openrouter/qwen/qwen-2.5-vl-72b-instruct:free',
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: true,
        primary: 'openai/gpt-image-1',
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
      },
    });

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: {
        defaults?: {
          workspace?: string;
          model?: { primary?: string; fallbacks?: string[] };
          models?: Record<string, Record<string, never>>;
          imageModel?: { primary?: string; fallbacks?: string[] };
          pdfModel?: { primary?: string; fallbacks?: string[] };
          imageGenerationModel?: { primary?: string; fallbacks?: string[] };
          videoGenerationModel?: { primary?: string; fallbacks?: string[] };
        };
      };
    };

    expect(config.agents?.defaults?.model).toEqual({
      primary: 'openai/gpt-5.4',
      fallbacks: ['openai/gpt-5.4-mini'],
    });
    expect(config.agents?.defaults?.imageModel).toBeUndefined();
    expect(config.agents?.defaults?.pdfModel).toEqual({
      primary: 'openrouter/qwen/qwen-2.5-vl-72b-instruct:free',
      fallbacks: [],
    });
    expect(config.agents?.defaults?.imageGenerationModel).toEqual({
      primary: 'openai/gpt-image-1',
      fallbacks: [],
    });
    expect(config.agents?.defaults?.videoGenerationModel).toBeUndefined();
    expect(config.agents?.defaults?.models).toEqual({
      'openai/gpt-5.4': {},
      'openai/gpt-5.4-mini': {},
      'openai/gpt-image-1': {},
      'openrouter/qwen/qwen-2.5-vl-72b-instruct:free': {},
      'qwen/wan2.6-t2v': {},
    });
  });

  it('does not expose disabled built-in provider models in available model refs', async () => {
    const { agentConfig } = await setupManagedPresetFixture({
      providerAccounts: {
        'google-account': {
          id: 'google-account',
          vendorId: 'google',
          label: 'Google',
          authMode: 'api_key',
          models: [],
          metadata: {
            modelCatalog: {
              disabledBuiltinModelIds: ['gemini-3.1-pro-preview'],
              disabledCustomModelIds: [],
              builtinModelOverrides: [],
              customModels: [],
            },
          },
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-13T00:00:00.000Z',
          updatedAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    await expect(agentConfig.getDefaultAgentModelConfig()).resolves.toMatchObject({
      availableModels: expect.arrayContaining([
        expect.objectContaining({
          providerId: 'google-account',
          modelRefs: ['google/gemini-3-flash-preview', 'google/gemini-3.1-flash-lite-preview'],
        }),
      ]),
    });
  });

  it('promotes referenced removed built-in models into provider custom models', async () => {
    const registry = await import('../../shared/providers/registry');
    const originalGetProviderDefinition = registry.getProviderDefinition;
    const getProviderDefinitionSpy = vi.spyOn(registry, 'getProviderDefinition').mockImplementation((type) => {
      const definition = originalGetProviderDefinition(type);
      if (type !== 'openai' || !definition) {
        return definition;
      }

      return {
        ...definition,
        defaultModelId: 'gpt-6.0',
        defaultModels: [{ id: 'gpt-6.0', name: 'gpt-6.0', reasoning: false }],
      };
    });

    try {
      const { configDir, providerStoreState, agentConfig } = await setupManagedPresetFixture({
        providerAccounts: {
          'openai-account': {
            id: 'openai-account',
            vendorId: 'openai',
            label: 'OpenAI',
            authMode: 'api_key',
            models: [],
            enabled: true,
            isDefault: false,
            createdAt: '2026-04-13T00:00:00.000Z',
            updatedAt: '2026-04-13T00:00:00.000Z',
          },
        },
      });

      writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
        agents: {
          defaults: {
            workspace: '/managed/workspace',
            model: {
              primary: 'openai/gpt-5.4',
              fallbacks: [],
            },
          },
        },
      }, null, 2), 'utf8');

      await expect(agentConfig.getDefaultAgentModelConfig()).resolves.toMatchObject({
        model: {
          configured: true,
          primary: 'openai/gpt-5.4',
          fallbacks: [],
        },
        availableModels: expect.arrayContaining([
          expect.objectContaining({
            providerId: 'openai-account',
            modelRefs: expect.arrayContaining(['openai/gpt-6.0', 'openai/gpt-5.4']),
          }),
        ]),
      });

      expect(providerStoreState.providerAccounts).toMatchObject({
        'openai-account': {
          metadata: {
            modelCatalog: {
              customModels: [
                {
                  id: 'gpt-5.4',
                  name: 'gpt-5.4',
                  reasoning: false,
                },
              ],
            },
          },
        },
      });
    } finally {
      getProviderDefinitionSpy.mockRestore();
    }
  });

  it('clears active managed restrictions after unmanage', async () => {
    const { agentConfig, homeDir } = await setupManagedPresetFixture();
    await agentConfig.installMarketplaceAgent('stockexpert');

    const snapshot = await agentConfig.unmanageAgent('stockexpert');

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      managed: false,
      manualSkills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
      presetSkills: [],
      managedFiles: [],
      canUseDefaultSkillScope: true,
    });
    expect(readFileSync(join(homeDir, 'geeclaw', 'workspace-stockexpert', 'skills', 'stock-analyzer', 'SKILL.md'), 'utf8')).toContain('Stock Analyzer');
  });

  it('keeps manualSkills undefined for agents that have not been migrated to explicit membership yet', async () => {
    const { agentConfig } = await setupManagedPresetFixture();

    const snapshot = await agentConfig.listAgentsSnapshot();

    expect(snapshot.agents.find((agent) => agent.id === 'main')).not.toHaveProperty('manualSkills');
  });

  it('preserves an explicitly empty manualSkills list after updating agent settings', async () => {
    const { agentConfig, configDir } = await setupManagedPresetFixture();

    await agentConfig.createAgent('Research Helper', 'research-helper');
    const snapshot = await agentConfig.updateAgentSettings('research-helper', {
      manualSkills: [],
    });

    expect(snapshot.agents.find((agent) => agent.id === 'research-helper')).toMatchObject({
      manualSkills: [],
    });

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; skills?: string[] }> };
    };
    expect(config.agents?.list?.find((agent) => agent.id === 'research-helper')?.skills).toEqual([]);
  });

  it('allows managed agents to edit user, memory, and soul files while keeping identity locked', async () => {
    const { agentConfig } = await setupManagedPresetFixture();
    await agentConfig.installMarketplaceAgent('stockexpert');

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

  it('respects marketplace managed policy for persona locks and unmanage permission', async () => {
    const { agentConfig } = await setupManagedPresetFixture({
      marketplacePackage: {
        meta: {
          managedPolicy: {
          lockedFields: ['id', 'workspace'],
          canUnmanage: false,
        },
        },
      },
    });
    const installed = await agentConfig.installMarketplaceAgent('stockexpert');

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
    await agentConfig.installMarketplaceAgent('stockexpert');
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

  it('rejects installing marketplace agents that are unsupported on the current platform', async () => {
    setPlatform('win32');
    const { agentConfig, homeDir, configDir } = await setupManagedPresetFixture({
      marketplacePackage: {
        catalogEntry: {
          platforms: ['darwin'],
        },
      },
    });
    const workspaceDir = join(homeDir, 'geeclaw', 'workspace-stockexpert');

    await expect(agentConfig.installMarketplaceAgent('stockexpert')).rejects.toThrow(
      'Marketplace agent "stockexpert" is only available on macOS',
    );

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string }> };
    };

    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')).toBeUndefined();
    expect(existsSync(workspaceDir)).toBe(false);
  });

  it('creates and deletes custom agents under the managed geeclaw workspace root', async () => {
    const { homeDir, configDir, storeState, agentConfig, deleteDesktopSessionsForAgent } = await setupManagedPresetFixture();

    const created = await agentConfig.createAgent('Research Helper', 'research-helper', 'gradient-sky');
    expect(created.agents.find((agent) => agent.id === 'research-helper')).toMatchObject({
      workspace: '~/geeclaw/workspace-research-helper',
      agentDir: '~/.openclaw-geeclaw/agents/research-helper/agent',
      avatarPresetId: 'gradient-sky',
      avatarSource: 'user',
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
    expect(configAfterCreate.agents?.list?.find((agent) => agent.id === 'research-helper')).not.toHaveProperty('avatarPresetId');
    expect(configAfterCreate.agents?.list?.find((agent) => agent.id === 'research-helper')).not.toHaveProperty('avatarSource');
    expect(storeState.agentAvatars).toMatchObject({
      'research-helper': {
        avatarPresetId: 'gradient-sky',
        avatarSource: 'user',
      },
    });
    expect(existsSync(join(homeDir, 'geeclaw', 'workspace-research-helper'))).toBe(true);

    const deletion = await agentConfig.deleteAgentConfig('research-helper');
    expect(deletion.removedEntry).toMatchObject({
      id: 'research-helper',
      workspace: '~/geeclaw/workspace-research-helper',
    });
    expect(storeState.agentAvatars).toBeUndefined();
    expect(existsSync(join(homeDir, 'geeclaw', 'workspace-research-helper'))).toBe(true);
    expect(deleteDesktopSessionsForAgent).toHaveBeenCalledWith('research-helper');
  });

  it('keeps a user-selected avatar when a marketplace agent updates', async () => {
    const { agentConfig, marketplaceState, configDir, storeState } = await setupManagedPresetFixture();

    await agentConfig.installMarketplaceAgent('stockexpert');
    await agentConfig.updateAgentSettings('stockexpert', {
      avatarPresetId: 'gradient-rose',
    });
    marketplaceState.preparedPackage.catalogEntry.version = '1.2.4';
    marketplaceState.preparedPackage.package.meta.packageVersion = '1.2.4';

    const updated = await agentConfig.updateMarketplaceAgent('stockexpert');
    expect(updated.agents.find((agent) => agent.id === 'stockexpert')).toMatchObject({
      avatarPresetId: 'gradient-rose',
      avatarSource: 'user',
    });
    expect(storeState.agentAvatars).toMatchObject({
      stockexpert: {
        avatarPresetId: 'gradient-rose',
        avatarSource: 'user',
      },
    });
    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; avatarPresetId?: string; avatarSource?: string }> };
    };
    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')).not.toHaveProperty('avatarPresetId');
    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')).not.toHaveProperty('avatarSource');
  });

  it('syncs per-agent active-memory membership when updating agent settings', async () => {
    const { agentConfig, configDir } = await setupManagedPresetFixture();

    await agentConfig.createAgent('Research Helper', 'research-helper');
    const configWithPlugin = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      plugins?: Record<string, unknown>;
    };
    configWithPlugin.plugins = {
      entries: {
        'active-memory': {
          enabled: true,
          config: {
            enabled: true,
            agents: ['main'],
          },
        },
      },
    };
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify(configWithPlugin, null, 2), 'utf8');

    await agentConfig.updateAgentSettings('research-helper', {
      activeMemoryEnabled: true,
    });

    let config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      plugins?: {
        entries?: {
          'active-memory'?: {
            config?: {
              agents?: string[];
            };
          };
        };
      };
    };
    expect(config.plugins?.entries?.['active-memory']?.config?.agents).toEqual(['main', 'research-helper']);

    await agentConfig.updateAgentSettings('research-helper', {
      activeMemoryEnabled: false,
    });

    config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      plugins?: {
        entries?: {
          'active-memory'?: {
            config?: {
              agents?: string[];
            };
          };
        };
      };
    };
    expect(config.plugins?.entries?.['active-memory']?.config?.agents).toEqual(['main']);
  });

  it('removes deleted agents from active-memory membership', async () => {
    const { agentConfig, configDir, homeDir } = await setupManagedPresetFixture();

    await agentConfig.createAgent('Research Helper', 'research-helper');
    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: {
        defaults?: { workspace?: string };
        list?: Array<{ id?: string; name?: string; workspace?: string }>;
      };
      plugins?: Record<string, unknown>;
    };
    config.plugins = {
      entries: {
        'active-memory': {
          enabled: true,
          config: {
            enabled: true,
            agents: ['main', 'research-helper'],
          },
        },
      },
    };
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');

    await agentConfig.deleteAgentConfig('research-helper');

    const nextConfig = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      plugins?: {
        entries?: {
          'active-memory'?: {
            config?: {
              agents?: string[];
            };
          };
        };
      };
    };
    expect(nextConfig.plugins?.entries?.['active-memory']?.config?.agents).toEqual(['main']);
    expect(existsSync(join(homeDir, 'geeclaw', 'workspace-research-helper'))).toBe(true);
  });

  it('uses tilde-based workspace defaults on Windows so OpenClaw can expand them', async () => {
    setPlatform('win32');
    const { agentConfig } = await setupManagedPresetFixture();

    const created = await agentConfig.createAgent('Windows Helper', 'windows-helper');
    expect(created.agents.find((agent) => agent.id === 'windows-helper')).toMatchObject({
      workspace: '~\\geeclaw\\workspace-windows-helper',
      agentDir: '~/.openclaw-geeclaw/agents/windows-helper/agent',
    });
  });
});
