import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';

let openclawConfigDir = '/tmp/openclaw-provider-config-test';
let configuredAgentIds = ['main'];

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => openclawConfigDir),
}));

vi.mock('@electron/utils/agent-config', () => ({
  listConfiguredAgentIds: vi.fn(async () => configuredAgentIds),
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderEnvVar: vi.fn(() => undefined),
  getProviderDefaultModel: vi.fn(() => undefined),
  getProviderConfig: vi.fn(() => undefined),
}));

vi.mock('@electron/utils/openclaw-config-coordinator', () => ({
  readOpenClawConfigDocument: vi.fn(async () => {
    try {
      return await readJson(join(openclawConfigDir, 'openclaw.json'));
    } catch {
      return {};
    }
  }),
  mutateOpenClawConfigDocument: vi.fn(async (mutator: (config: Record<string, unknown>) => Promise<{ changed: boolean; result: unknown }> | { changed: boolean; result: unknown }) => {
    const configPath = join(openclawConfigDir, 'openclaw.json');
    let config: Record<string, unknown>;

    try {
      config = await readJson(configPath);
    } catch {
      config = {};
    }

    const outcome = await mutator(config);
    if (outcome.changed) {
      await mkdir(openclawConfigDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    }

    return outcome.result;
  }),
}));

async function writeOpenClawJson(data: unknown): Promise<void> {
  await mkdir(openclawConfigDir, { recursive: true });
  await writeFile(join(openclawConfigDir, 'openclaw.json'), JSON.stringify(data, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  return await readJson(join(openclawConfigDir, 'openclaw.json'));
}

async function writeAgentAuthProfiles(agentId: string, data: unknown): Promise<void> {
  const agentDir = join(openclawConfigDir, 'agents', agentId, 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth-profiles.json'), JSON.stringify(data, null, 2), 'utf8');
}

async function readAgentAuthProfiles(agentId: string): Promise<Record<string, unknown>> {
  return await readJson(join(openclawConfigDir, 'agents', agentId, 'agent', 'auth-profiles.json'));
}

async function writeAgentModels(agentId: string, data: unknown): Promise<void> {
  const agentDir = join(openclawConfigDir, 'agents', agentId, 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'models.json'), JSON.stringify(data, null, 2), 'utf8');
}

async function readAgentModels(agentId: string): Promise<Record<string, unknown>> {
  return await readJson(join(openclawConfigDir, 'agents', agentId, 'agent', 'models.json'));
}

describe('removeProviderFromOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    configuredAgentIds = ['main'];
    openclawConfigDir = await mkdtemp(join(tmpdir(), 'geeclaw-provider-config-'));
  });

  afterEach(async () => {
    await rm(openclawConfigDir, { recursive: true, force: true });
  });

  it('removes matching auth profile residue from auth stores and openclaw.json', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'custom-abc12345': {
            baseUrl: 'https://api.example.com/v1',
            api: 'openai-completions',
          },
          anthropic: {
            baseUrl: 'https://api.anthropic.com/v1',
            api: 'anthropic-messages',
          },
        },
      },
      auth: {
        profiles: {
          'custom-abc12345:oauth': {
            type: 'oauth',
            provider: 'custom-abc12345',
            access: 'acc',
            refresh: 'ref',
            expires: 1,
          },
          'custom-abc12345:secondary': {
            type: 'api_key',
            provider: 'custom-abc12345',
            key: 'sk-inline',
          },
          'anthropic:default': {
            type: 'api_key',
            provider: 'anthropic',
            key: 'sk-ant',
          },
        },
      },
    });

    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'custom-abc12345:default': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-main',
        },
        'custom-abc12345:backup': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-backup',
        },
        'anthropic:default': {
          type: 'api_key',
          provider: 'anthropic',
          key: 'sk-ant',
        },
      },
      order: {
        'custom-abc12345': [
          'custom-abc12345:default',
          'custom-abc12345:backup',
        ],
        anthropic: ['anthropic:default'],
      },
      lastGood: {
        'custom-abc12345': 'custom-abc12345:backup',
        anthropic: 'anthropic:default',
      },
    });

    await writeAgentModels('main', {
      providers: {
        'custom-abc12345': {
          baseUrl: 'https://api.example.com/v1',
          api: 'openai-completions',
        },
        anthropic: {
          baseUrl: 'https://api.anthropic.com/v1',
          api: 'anthropic-messages',
        },
      },
    });

    const { removeProviderFromOpenClaw } = await import('@electron/utils/openclaw-provider-config');

    await removeProviderFromOpenClaw('custom-abc12345');

    const authProfiles = await readAgentAuthProfiles('main');
    const models = await readAgentModels('main');
    const config = await readOpenClawJson();

    expect(authProfiles).toEqual({
      version: 1,
      profiles: {
        'anthropic:default': {
          type: 'api_key',
          provider: 'anthropic',
          key: 'sk-ant',
        },
      },
      order: {
        anthropic: ['anthropic:default'],
      },
      lastGood: {
        anthropic: 'anthropic:default',
      },
    });

    expect(models).toEqual({
      providers: {
        anthropic: {
          baseUrl: 'https://api.anthropic.com/v1',
          api: 'anthropic-messages',
        },
      },
    });

    expect(config.models).toEqual({
      providers: {
        anthropic: {
          baseUrl: 'https://api.anthropic.com/v1',
          api: 'anthropic-messages',
        },
      },
    });
    expect(config.auth).toEqual({
      profiles: {
        'anthropic:default': {
          type: 'api_key',
          provider: 'anthropic',
          key: 'sk-ant',
        },
      },
    });
  });

  it('maps MiniMax OAuth provider sync to the canonical minimax plugin id', async () => {
    await writeOpenClawJson({
      plugins: {
        allow: ['minimax-portal-auth'],
        entries: {
          'minimax-portal-auth': { enabled: true },
        },
      },
    });

    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-provider-config');

    await syncProviderConfigToOpenClaw('minimax-portal', ['MiniMax-M2.7'], {
      baseUrl: 'https://api.minimax.io/anthropic',
      api: 'anthropic-messages',
      apiKeyEnv: 'minimax-oauth',
      authHeader: true,
    });

    const config = await readOpenClawJson();
    const plugins = config.plugins as {
      allow?: string[];
      entries?: Record<string, { enabled?: boolean }>;
    };

    expect(plugins.allow).toContain('minimax');
    expect(plugins.allow).not.toContain('minimax-portal-auth');
    expect(plugins.entries?.minimax?.enabled).toBe(true);
    expect(plugins.entries?.['minimax-portal-auth']).toBeUndefined();
  });

  it('maps MiniMax OAuth default-model writes to the canonical minimax plugin id', async () => {
    await writeOpenClawJson({
      plugins: {
        allow: ['minimax-portal-auth'],
        entries: {
          'minimax-portal-auth': { enabled: true },
        },
      },
    });

    const { setOpenClawDefaultModelWithOverride } = await import('@electron/utils/openclaw-provider-config');

    await setOpenClawDefaultModelWithOverride('minimax-portal', 'minimax-portal/MiniMax-M2.7', {
      baseUrl: 'https://api.minimax.io/anthropic',
      api: 'anthropic-messages',
      apiKeyEnv: 'minimax-oauth',
      authHeader: true,
    });

    const config = await readOpenClawJson();
    const plugins = config.plugins as {
      allow?: string[];
      entries?: Record<string, { enabled?: boolean }>;
    };

    expect(plugins.allow).toContain('minimax');
    expect(plugins.allow).not.toContain('minimax-portal-auth');
    expect(plugins.entries?.minimax?.enabled).toBe(true);
    expect(plugins.entries?.['minimax-portal-auth']).toBeUndefined();
  });
});
