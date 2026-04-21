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

vi.mock('@electron/main/local-llm-proxy', () => ({
  getLocalLlmProxyPort: vi.fn(() => 19100),
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
    if (type === 'geeclaw') {
      return 'GEECLAW_API_KEY';
    }
    return undefined;
  }),
  getProviderConfig: vi.fn((type: string) => {
    if (type === 'geeclaw') {
      return {
        baseUrl: 'https://geekai.co/api/v1',
        api: 'openai-completions',
        apiKeyEnv: 'GEECLAW_API_KEY',
      };
    }
    return undefined;
  }),
  getProviderDefaultModel: vi.fn((type: string) => (type === 'geeclaw' ? 'qwen3.6-plus' : undefined)),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getProviderAccount, listProviderAccounts, providerAccountToConfig } from '@electron/services/providers/provider-store';
import { getProviderSecret } from '@electron/services/secrets/secret-store';
import {
  syncAllProviderAuthToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
  syncDefaultProviderToRuntime,
} from '@electron/services/providers/provider-runtime-sync';
import { getDefaultAgentModelConfig } from '@electron/utils/agent-config';
import { saveProviderKeyToOpenClaw } from '@electron/utils/openclaw-auth';
import {
  removeProviderFromOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
} from '@electron/utils/openclaw-provider-config';
import { getApiKey, getDefaultProvider, getProvider, type ProviderConfig } from '@electron/utils/secure-storage';
import type { ProviderAccount } from '@electron/shared/providers/types';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'geeclaw-account',
    name: 'GeeClaw',
    type: 'geeclaw',
    enabled: true,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'geeclaw-account',
    vendorId: 'geeclaw',
    label: 'GeeClaw',
    authMode: 'api_key',
    enabled: true,
    isDefault: true,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

function providerAccountToConfigForTest(account: ProviderAccount): ProviderConfig {
  return {
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    models: account.models,
    model: account.model,
    fallbackModels: account.fallbackModels,
    fallbackProviderIds: account.fallbackAccountIds,
    metadata: account.metadata,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

describe('GeeClaw provider runtime sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getProvider).mockResolvedValue(makeProvider());
    vi.mocked(getProviderAccount).mockResolvedValue(makeAccount());
    vi.mocked(providerAccountToConfig).mockImplementation(providerAccountToConfigForTest);
    vi.mocked(getProviderSecret).mockResolvedValue({
      type: 'api_key',
      accountId: 'geeclaw-account',
      apiKey: 'user-secret',
    });
    vi.mocked(getApiKey).mockResolvedValue('user-secret');
    vi.mocked(getDefaultProvider).mockResolvedValue('geeclaw-account');
    vi.mocked(listProviderAccounts).mockResolvedValue([]);
    vi.mocked(getDefaultAgentModelConfig).mockResolvedValue({
      model: {
        configured: true,
        primary: 'geeclaw/qwen3.6-plus',
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
      primary: 'geeclaw/qwen3.6-plus',
      fallbacks: [],
    } as Awaited<ReturnType<typeof getDefaultAgentModelConfig>>);
  });

  it('writes GeeClaw runtime config to the local proxy and skips auth-profile sync', async () => {
    await syncSavedProviderToRuntime(makeProvider(), undefined);

    expect(syncProviderConfigToOpenClaw).toHaveBeenCalledWith(
      'geeclaw',
      expect.any(Array),
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:19100/proxy',
        api: 'openai-completions',
        apiKeyEnv: 'GEECLAW_API_KEY',
      }),
    );
    expect(updateAgentModelProvider).toHaveBeenCalledWith(
      'geeclaw',
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:19100/proxy',
        api: 'openai-completions',
        apiKey: 'GEECLAW_API_KEY',
      }),
    );
    expect(saveProviderKeyToOpenClaw).not.toHaveBeenCalled();
  });

  it('removes GeeClaw runtime config when the provider is disabled', async () => {
    await syncUpdatedProviderToRuntime(makeProvider({ enabled: false }), undefined);

    expect(removeProviderFromOpenClaw).toHaveBeenCalledWith('geeclaw');
    expect(syncProviderConfigToOpenClaw).not.toHaveBeenCalled();
    expect(saveProviderKeyToOpenClaw).not.toHaveBeenCalled();
  });

  it('uses a local override when GeeClaw is the default provider', async () => {
    await syncDefaultProviderToRuntime('geeclaw-account');

    expect(setOpenClawDefaultModelWithOverride).toHaveBeenCalledWith(
      'geeclaw',
      'geeclaw/qwen3.6-plus',
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:19100/proxy',
        api: 'openai-completions',
        apiKeyEnv: 'GEECLAW_API_KEY',
      }),
      [],
    );
    expect(setOpenClawDefaultModel).not.toHaveBeenCalled();
    expect(saveProviderKeyToOpenClaw).not.toHaveBeenCalled();
  });

  it('ignores legacy GeekAI accounts during auth sync after upgrade', async () => {
    vi.mocked(listProviderAccounts).mockResolvedValue([
      makeAccount({
        id: 'legacy-geekai-account',
        vendorId: 'geekai' as never,
        label: 'GeekAI',
      }),
    ]);
    vi.mocked(getProviderSecret).mockResolvedValue({
      type: 'api_key',
      accountId: 'legacy-geekai-account',
      apiKey: 'legacy-secret',
    });

    await syncAllProviderAuthToRuntime();

    expect(saveProviderKeyToOpenClaw).not.toHaveBeenCalled();
  });
});
