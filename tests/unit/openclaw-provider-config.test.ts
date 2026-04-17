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
  getProviderEnvVar: vi.fn((provider: string) => {
    if (provider === 'geeclaw') {
      return 'GEECLAW_API_KEY';
    }
    if (provider === 'openrouter') {
      return 'OPENROUTER_API_KEY';
    }
    if (provider === 'moonshot') {
      return 'MOONSHOT_API_KEY';
    }
    if (provider === 'moonshot-global') {
      return 'MOONSHOT_GLOBAL_API_KEY';
    }
    return undefined;
  }),
  getProviderDefaultModel: vi.fn(() => undefined),
  getProviderConfig: vi.fn((provider: string) => {
    if (provider === 'geeclaw') {
      return {
        baseUrl: 'https://geekai.co/api/v1',
        api: 'openai-completions',
        apiKeyEnv: 'GEECLAW_API_KEY',
      };
    }
    if (provider === 'moonshot') {
      return {
        baseUrl: 'https://api.moonshot.cn/v1',
        api: 'openai-completions',
        apiKeyEnv: 'MOONSHOT_API_KEY',
      };
    }
    if (provider === 'moonshot-global') {
      return {
        baseUrl: 'https://api.moonshot.ai/v1',
        api: 'openai-completions',
        apiKeyEnv: 'MOONSHOT_GLOBAL_API_KEY',
      };
    }
    return undefined;
  }),
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

  it('writes structured provider model metadata into openclaw.json', async () => {
    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-provider-config');

    await syncProviderConfigToOpenClaw('openrouter', [
      {
        id: 'google/gemini-3-flash-preview',
        name: 'google/gemini-3-flash-preview',
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 1048576,
        maxTokens: 65536,
      },
      {
        id: 'openai/gpt-5.4',
        name: 'openai/gpt-5.4',
        reasoning: false,
        input: ['text'],
      },
    ], {
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKeyEnv: 'OPENROUTER_API_KEY',
    });

    const config = await readOpenClawJson();
    const providers = ((config.models as { providers?: Record<string, unknown> })?.providers ?? {}) as Record<string, {
      baseUrl?: string;
      api?: string;
      models?: Array<Record<string, unknown>>;
    }>;

    expect(providers.openrouter).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKey: '${OPENROUTER_API_KEY}',
    });
    expect(providers.openrouter?.models).toEqual([
      {
        id: 'google/gemini-3-flash-preview',
        name: 'google/gemini-3-flash-preview',
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 1048576,
        maxTokens: 65536,
      },
      {
        id: 'openai/gpt-5.4',
        name: 'openai/gpt-5.4',
        reasoning: false,
      },
    ]);
  });

  it('writes env-backed api_key providers as interpolated env var references in agent models.json', async () => {
    await writeAgentModels('main', {
      providers: {
        openrouter: {
          baseUrl: 'https://openrouter.ai/api/v1',
          api: 'openai-completions',
          apiKey: 'stale-key',
        },
      },
    });

    const { updateAgentModelProvider } = await import('@electron/utils/openclaw-provider-config');

    await updateAgentModelProvider('openrouter', {
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKey: 'OPENROUTER_API_KEY',
    });

    const models = await readAgentModels('main');
    const providers = (models.providers ?? {}) as Record<string, { apiKey?: string }>;

    expect(providers.openrouter?.apiKey).toBe('${OPENROUTER_API_KEY}');
  });

  it('writes GeeClaw apiKey as an interpolated env var reference in openclaw.json', async () => {
    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-provider-config');

    await syncProviderConfigToOpenClaw('geeclaw', [
      {
        id: 'qwen3.6-plus',
        name: 'qwen3.6-plus',
        reasoning: false,
        input: ['text', 'image'],
      },
    ], {
      baseUrl: 'http://127.0.0.1:19100/proxy',
      api: 'openai-completions',
      apiKeyEnv: 'GEECLAW_API_KEY',
    });

    const config = await readOpenClawJson();
    const providers = ((config.models as { providers?: Record<string, unknown> })?.providers ?? {}) as Record<string, {
      apiKey?: string;
    }>;

    expect(providers.geeclaw?.apiKey).toBe('${GEECLAW_API_KEY}');
  });

  it('writes GeeClaw apiKey as an interpolated env var reference in agent models.json', async () => {
    await writeAgentModels('main', {
      providers: {
        geeclaw: {
          baseUrl: 'http://127.0.0.1:19000/proxy',
          api: 'openai-completions',
          apiKey: 'stale-key',
        },
      },
    });

    const { updateAgentModelProvider } = await import('@electron/utils/openclaw-provider-config');

    await updateAgentModelProvider('geeclaw', {
      baseUrl: 'http://127.0.0.1:19100/proxy',
      api: 'openai-completions',
      apiKey: 'GEECLAW_API_KEY',
    });

    const models = await readAgentModels('main');
    const providers = (models.providers ?? {}) as Record<string, { apiKey?: string }>;

    expect(providers.geeclaw?.apiKey).toBe('${GEECLAW_API_KEY}');
  });

  it('syncs Moonshot Global provider baseUrl into the Kimi web search plugin config', async () => {
    await writeOpenClawJson({
      plugins: {
        entries: {
          moonshot: {
            enabled: true,
            config: {
              webSearch: {
                apiKey: 'sk-kimi-search',
                model: 'kimi-search-v1',
                timeoutSeconds: 15,
              },
            },
          },
        },
      },
    });

    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-provider-config');

    await syncProviderConfigToOpenClaw('moonshot-global', [
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        reasoning: false,
        input: ['text'],
      },
    ], {
      baseUrl: 'https://api.moonshot.ai/v1',
      api: 'openai-completions',
      apiKeyEnv: 'MOONSHOT_GLOBAL_API_KEY',
    });

    const config = await readOpenClawJson();
    const kimiWebSearch = (((((config.plugins as Record<string, unknown>).entries as Record<string, unknown>).moonshot as Record<string, unknown>).config as Record<string, unknown>).webSearch as Record<string, unknown>);
    const providerEntry = (((config.models as Record<string, unknown>).providers as Record<string, unknown>)['moonshot-global'] as Record<string, unknown>);

    expect(kimiWebSearch).toEqual({
      apiKey: 'sk-kimi-search',
      model: 'kimi-search-v1',
      timeoutSeconds: 15,
      baseUrl: 'https://api.moonshot.ai/v1',
    });
    expect(providerEntry).toMatchObject({
      baseUrl: 'https://api.moonshot.ai/v1',
      api: 'openai-completions',
      apiKey: '${MOONSHOT_GLOBAL_API_KEY}',
    });
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
