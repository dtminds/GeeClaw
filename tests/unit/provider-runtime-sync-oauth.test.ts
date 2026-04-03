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

import type { ProviderAccount } from '@shared/providers/types';
import { getProviderAccount } from '@electron/services/providers/provider-store';
import { getProviderSecret } from '@electron/services/secrets/secret-store';
import {
  syncDefaultProviderToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '@electron/services/providers/provider-runtime-sync';
import { getDefaultAgentModelConfig } from '@electron/utils/agent-config';
import { removeProviderKeyFromOpenClaw, saveOAuthTokenToOpenClaw } from '@electron/utils/openclaw-auth';
import {
  removeProviderFromOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
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
      fallbacks: ['anthropic/claude-sonnet-4-5'],
    } as Awaited<ReturnType<typeof getDefaultAgentModelConfig>>);
  });

  it('uses the openai-codex runtime provider for OpenAI browser OAuth defaults', async () => {
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

  it('uses gemini-3-flash-preview as the Google browser OAuth fallback model', async () => {
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
      'google-gemini-cli/gemini-3-flash-preview',
      ['anthropic/claude-sonnet-4-5'],
    );
  });

  it('keeps bare configured model ids under the openai-codex runtime namespace', async () => {
    vi.mocked(getProvider).mockResolvedValue(makeProvider({
      models: ['gpt-5.3-codex-mini', 'gpt-5.3-codex'],
      model: 'gpt-5.3-codex-mini',
    }));

    await syncDefaultProviderToRuntime('openai-account');

    expect(setOpenClawDefaultModel).toHaveBeenCalledWith(
      'openai-codex',
      'openai-codex/gpt-5.3-codex-mini',
      ['anthropic/claude-sonnet-4-5'],
    );
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
      ['qwen3:30b'],
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
