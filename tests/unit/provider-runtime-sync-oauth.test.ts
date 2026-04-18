import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: vi.fn(),
  listProviderAccounts: vi.fn(),
  providerAccountToConfig: vi.fn(),
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: vi.fn(),
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: vi.fn(),
  getDefaultProvider: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  removeProviderKeyFromOpenClaw: vi.fn(),
  saveOAuthTokenToOpenClaw: vi.fn(),
  saveProviderKeyToOpenClaw: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-provider-config', () => ({
  removeProviderFromOpenClaw: vi.fn(),
  setOpenClawDefaultModel: vi.fn(),
  setOpenClawDefaultModelWithOverride: vi.fn(),
  syncProviderConfigToOpenClaw: vi.fn(),
  updateAgentModelProvider: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  getDefaultAgentModelConfig: vi.fn(),
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderEnvVar: vi.fn((type: string) => {
    if (type === 'openai') {
      return 'OPENAI_API_KEY';
    }
    return undefined;
  }),
  getProviderConfig: vi.fn((type: string) => {
    if (type === 'openai') {
      return {
        baseUrl: 'https://api.openai.com/v1',
        api: 'openai-responses',
        apiKeyEnv: 'OPENAI_API_KEY',
      };
    }
    return undefined;
  }),
  getProviderDefaultModel: vi.fn((type: string) => (type === 'openai' ? 'gpt-5.4' : undefined)),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import type { ProviderAccount } from '@electron/shared/providers/types';
import { getProviderAccount } from '@electron/services/providers/provider-store';
import { getProviderSecret } from '@electron/services/secrets/secret-store';
import {
  syncDefaultProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncAllProviderAuthToRuntime,
  syncUpdatedProviderToRuntime,
} from '@electron/services/providers/provider-runtime-sync';
import { getDefaultAgentModelConfig } from '@electron/utils/agent-config';
import {
  removeProviderKeyFromOpenClaw,
  saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw,
} from '@electron/utils/openclaw-auth';
import {
  removeProviderFromOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
} from '@electron/utils/openclaw-provider-config';
import type { ProviderConfig } from '@electron/utils/secure-storage';
import { getApiKey, getDefaultProvider, getProvider } from '@electron/utils/secure-storage';
import {
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
} from '@electron/services/providers/provider-runtime-sync';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'openai-account',
    name: 'OpenAI',
    type: 'openai',
    enabled: true,
    createdAt: '2026-03-27T00:00:00.000Z',
    updatedAt: '2026-03-27T00:00:00.000Z',
    ...overrides,
  };
}

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'openai-account',
    vendorId: 'openai',
    label: 'OpenAI',
    authMode: 'oauth_browser',
    enabled: true,
    isDefault: true,
    createdAt: '2026-03-27T00:00:00.000Z',
    updatedAt: '2026-03-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('provider runtime sync for browser OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getProvider).mockResolvedValue(makeProvider());
    vi.mocked(getProviderAccount).mockResolvedValue(makeAccount());
    vi.mocked(getApiKey).mockResolvedValue(null);
    vi.mocked(getProviderSecret).mockResolvedValue({
      type: 'oauth',
      accountId: 'openai-account',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1710000000000,
      subject: 'chatgpt-account-id',
    });
    vi.mocked(getDefaultAgentModelConfig).mockResolvedValue({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: ['anthropic/claude-sonnet-4-5'],
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
        configured: false,
        primary: null,
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      primary: 'openai/gpt-5.4',
      fallbacks: ['anthropic/claude-sonnet-4-5'],
    } as Awaited<ReturnType<typeof getDefaultAgentModelConfig>>);
  });

  it('uses the explicit chat model when syncing OpenAI browser OAuth defaults', async () => {
    vi.mocked(getProvider).mockResolvedValue(makeProvider());

    await syncDefaultProviderToRuntime('openai-account');

    expect(saveOAuthTokenToOpenClaw).toHaveBeenCalledWith(
      'openai-codex',
      expect.objectContaining({
        access: 'access-token',
        refresh: 'refresh-token',
        expires: 1710000000000,
        projectId: 'chatgpt-account-id',
      }),
    );
    expect(setOpenClawDefaultModel).toHaveBeenCalledWith(
      'openai-codex',
      'openai-codex/gpt-5.4',
      ['anthropic/claude-sonnet-4-5'],
    );
  });

  it('maps Google browser OAuth primary refs into the gemini runtime namespace', async () => {
    vi.mocked(getProvider).mockResolvedValue({
      ...makeProvider({
        id: 'google-account',
        name: 'Google',
        type: 'google',
      }),
      id: 'google-account',
      name: 'Google',
      type: 'google',
    });
    vi.mocked(getProviderAccount).mockResolvedValue(makeAccount({
      id: 'google-account',
      vendorId: 'google',
      label: 'Google',
    }));
    vi.mocked(getProviderSecret).mockResolvedValue({
      type: 'oauth',
      accountId: 'google-account',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1710000000000,
      subject: 'google-account-id',
    });
    vi.mocked(getDefaultAgentModelConfig).mockResolvedValueOnce({
      model: {
        configured: true,
        primary: 'google/gemini-2.5-pro',
        fallbacks: ['anthropic/claude-sonnet-4-5'],
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
        configured: false,
        primary: null,
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      primary: 'google/gemini-2.5-pro',
      fallbacks: ['anthropic/claude-sonnet-4-5'],
    } as Awaited<ReturnType<typeof getDefaultAgentModelConfig>>);

    await syncDefaultProviderToRuntime('google-account');

    expect(saveOAuthTokenToOpenClaw).toHaveBeenCalledWith(
      'google-gemini-cli',
      expect.objectContaining({
        access: 'access-token',
        refresh: 'refresh-token',
        expires: 1710000000000,
      }),
    );
    expect(setOpenClawDefaultModel).toHaveBeenCalledWith(
      'google-gemini-cli',
      'google-gemini-cli/gemini-2.5-pro',
      ['anthropic/claude-sonnet-4-5'],
    );
  });

  it('does not infer a default chat model from the provider when no explicit model is configured', async () => {
    vi.mocked(getDefaultAgentModelConfig).mockResolvedValueOnce({
      model: {
        configured: false,
        primary: null,
        fallbacks: [],
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
        configured: false,
        primary: null,
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      primary: null,
      fallbacks: [],
    } as Awaited<ReturnType<typeof getDefaultAgentModelConfig>>);

    await syncDefaultProviderToRuntime('openai-account');

    expect(setOpenClawDefaultModel).not.toHaveBeenCalled();
    expect(setOpenClawDefaultModelWithOverride).not.toHaveBeenCalled();
  });

  it('removes both runtime and stored keys when deleting a custom provider', async () => {
    await syncDeletedProviderToRuntime(makeProvider({
      id: 'moonshot-cn',
      name: 'Moonshot Custom',
      type: 'custom',
      baseUrl: 'https://api.moonshot.cn/v1',
    }), 'moonshot-cn');

    expect(removeProviderFromOpenClaw).toHaveBeenCalledWith('custom-moonshot');
    expect(removeProviderFromOpenClaw).toHaveBeenCalledWith('moonshot-cn');
    expect(removeProviderFromOpenClaw).toHaveBeenCalledTimes(2);
  });

  it('only clears the api-key auth profile when deleting a provider key', async () => {
    vi.mocked(getProviderAccount).mockResolvedValue(makeAccount({
      authMode: 'api_key',
      isDefault: false,
    }));

    await syncDeletedProviderApiKeyToRuntime(makeProvider(), 'openai-account');

    expect(removeProviderKeyFromOpenClaw).toHaveBeenCalledWith('openai');
    expect(removeProviderFromOpenClaw).not.toHaveBeenCalled();
  });

  it('restarts a running gateway when deleting an env-backed provider key directly', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedRestart: vi.fn(),
    };

    vi.mocked(getProviderAccount).mockResolvedValue(makeAccount({
      authMode: 'api_key',
      isDefault: false,
    }));

    await syncDeletedProviderApiKeyToRuntime(makeProvider(), 'openai-account', undefined, gatewayManager as never);

    expect(removeProviderKeyFromOpenClaw).toHaveBeenCalledWith('openai');
    expect(gatewayManager.debouncedRestart).toHaveBeenCalledTimes(1);
  });

  it('removes stale auth-profiles api_key entries when syncing an api_key provider key to runtime', async () => {
    await syncProviderApiKeyToRuntime('openai', 'openai-account', 'sk-new');

    expect(removeProviderKeyFromOpenClaw).toHaveBeenCalledWith('openai');
    expect(saveProviderKeyToOpenClaw).not.toHaveBeenCalled();
    expect(saveOAuthTokenToOpenClaw).not.toHaveBeenCalled();
  });

  it('restarts a running gateway when syncing an env-backed api_key provider key directly', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedRestart: vi.fn(),
    };

    await syncProviderApiKeyToRuntime('openai', 'openai-account', 'sk-new', gatewayManager as never);

    expect(removeProviderKeyFromOpenClaw).toHaveBeenCalledWith('openai');
    expect(gatewayManager.debouncedRestart).toHaveBeenCalledTimes(1);
  });

  it('syncs custom provider api key updates into agent models.json', async () => {
    vi.mocked(getProvider).mockResolvedValue(makeProvider({
      id: 'custom-work',
      name: 'Custom Work',
      type: 'custom',
      baseUrl: 'https://api.example.com/v1',
      apiProtocol: 'openai-completions',
      models: ['gpt-4.1'],
    }));

    await syncProviderApiKeyToRuntime('custom', 'custom-work', 'sk-custom-live');

    expect(saveProviderKeyToOpenClaw).toHaveBeenCalledWith('custom-work', 'sk-custom-live');
    expect(updateAgentModelProvider).toHaveBeenCalledWith('custom-work', expect.objectContaining({
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      apiKey: 'sk-custom-live',
    }));
  });

  it('clears custom provider api keys from agent models.json when deleted', async () => {
    const customProvider = makeProvider({
      id: 'custom-work',
      name: 'Custom Work',
      type: 'custom',
      baseUrl: 'https://api.example.com/v1',
      apiProtocol: 'openai-completions',
      models: ['gpt-4.1'],
    });

    await syncDeletedProviderApiKeyToRuntime(customProvider, 'custom-work');

    expect(removeProviderKeyFromOpenClaw).toHaveBeenCalledWith('custom-work');
    expect(updateAgentModelProvider).toHaveBeenCalledWith('custom-work', expect.objectContaining({
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      apiKey: '',
    }));
  });

  it('removes stale auth-profiles api_key entries instead of writing them during provider auth sync', async () => {
    const { listProviderAccounts } = await import('@electron/services/providers/provider-store');

    vi.mocked(listProviderAccounts).mockResolvedValue([
      makeAccount({
        authMode: 'api_key',
        isDefault: false,
      }),
    ]);
    vi.mocked(getProviderAccount).mockResolvedValue(makeAccount({
      authMode: 'api_key',
      isDefault: false,
    }));
    vi.mocked(getProviderSecret).mockResolvedValue({
      type: 'api_key',
      accountId: 'openai-account',
      apiKey: 'sk-live',
    });

    await syncAllProviderAuthToRuntime();

    expect(removeProviderKeyFromOpenClaw).toHaveBeenCalledWith('openai');
    expect(saveProviderKeyToOpenClaw).not.toHaveBeenCalled();
    expect(saveOAuthTokenToOpenClaw).not.toHaveBeenCalled();
  });

  it('clears stale auth-profiles api_key entries when switching the default provider in api_key mode', async () => {
    vi.mocked(getProviderAccount).mockResolvedValue(makeAccount({
      authMode: 'api_key',
      isDefault: true,
    }));
    vi.mocked(getApiKey).mockResolvedValue('sk-live');

    await syncDefaultProviderToRuntime('openai-account');

    expect(removeProviderKeyFromOpenClaw).toHaveBeenCalledWith('openai');
    expect(saveProviderKeyToOpenClaw).not.toHaveBeenCalled();
    expect(saveOAuthTokenToOpenClaw).not.toHaveBeenCalled();
  });

  it('syncs Ollama provider config to runtime with the openai-completions protocol', async () => {
    const ollamaProvider = makeProvider({
      id: 'ollamafd',
      name: 'Ollama',
      type: 'ollama',
      model: 'qwen3:30b',
      baseUrl: 'http://localhost:11434/v1',
    });
    vi.mocked(getProviderSecret).mockResolvedValue({
      type: 'local',
      accountId: 'ollamafd',
      apiKey: 'ollama-local',
    });

    await syncSavedProviderToRuntime(ollamaProvider, undefined);

    expect(syncProviderConfigToOpenClaw).toHaveBeenCalledWith(
      'ollama-ollamafd',
      [
        {
          id: 'qwen3:30b',
          name: 'qwen3:30b',
          reasoning: false,
        },
      ],
      expect.objectContaining({
        baseUrl: 'http://localhost:11434/v1',
        api: 'openai-completions',
      }),
    );
  });

  it('syncs Ollama default providers with an explicit runtime override', async () => {
    const ollamaProvider = makeProvider({
      id: 'ollamafd',
      name: 'Ollama',
      type: 'ollama',
      model: 'qwen3:30b',
      baseUrl: 'http://localhost:11434/v1',
    });
    vi.mocked(getProvider).mockResolvedValue(ollamaProvider);
    vi.mocked(getDefaultAgentModelConfig).mockResolvedValueOnce({
      model: {
        configured: true,
        primary: 'ollama-ollamafd/qwen3:30b',
        fallbacks: ['anthropic/claude-sonnet-4-5'],
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
        configured: false,
        primary: null,
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      primary: 'ollama-ollamafd/qwen3:30b',
      fallbacks: ['anthropic/claude-sonnet-4-5'],
    } as Awaited<ReturnType<typeof getDefaultAgentModelConfig>>);

    await syncDefaultProviderToRuntime('ollamafd');

    expect(setOpenClawDefaultModelWithOverride).toHaveBeenCalledWith(
      'ollama-ollamafd',
      'ollama-ollamafd/qwen3:30b',
      expect.objectContaining({
        baseUrl: 'http://localhost:11434/v1',
        api: 'openai-completions',
      }),
      ['anthropic/claude-sonnet-4-5'],
    );
  });

  it('keeps the explicit override path when updating the default Ollama provider', async () => {
    const ollamaProvider = makeProvider({
      id: 'ollamafd',
      name: 'Ollama',
      type: 'ollama',
      model: 'qwen3:30b',
      baseUrl: 'http://localhost:11434/v1',
    });
    vi.mocked(getDefaultProvider).mockResolvedValue('ollamafd');
    vi.mocked(getProviderSecret).mockResolvedValue({
      type: 'local',
      accountId: 'ollamafd',
      apiKey: 'ollama-local',
    });
    vi.mocked(getDefaultAgentModelConfig).mockResolvedValueOnce({
      model: {
        configured: true,
        primary: 'ollama-ollamafd/qwen3:30b',
        fallbacks: ['anthropic/claude-sonnet-4-5'],
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
        configured: false,
        primary: null,
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      primary: 'ollama-ollamafd/qwen3:30b',
      fallbacks: ['anthropic/claude-sonnet-4-5'],
    } as Awaited<ReturnType<typeof getDefaultAgentModelConfig>>);

    await syncUpdatedProviderToRuntime(ollamaProvider, undefined);

    expect(setOpenClawDefaultModelWithOverride).toHaveBeenCalledWith(
      'ollama-ollamafd',
      'ollama-ollamafd/qwen3:30b',
      expect.objectContaining({
        baseUrl: 'http://localhost:11434/v1',
        api: 'openai-completions',
      }),
      ['anthropic/claude-sonnet-4-5'],
    );
    expect(setOpenClawDefaultModel).not.toHaveBeenCalled();
  });
});
