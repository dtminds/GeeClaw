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
  getProviderDefaultModel: vi.fn((type: string) => (type === 'openai' ? 'gpt-5.2' : undefined)),
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
import { syncDefaultProviderToRuntime } from '@electron/services/providers/provider-runtime-sync';
import { getDefaultAgentModelConfig } from '@electron/utils/agent-config';
import { saveOAuthTokenToOpenClaw } from '@electron/utils/openclaw-auth';
import { setOpenClawDefaultModel } from '@electron/utils/openclaw-provider-config';
import type { ProviderConfig } from '@electron/utils/secure-storage';
import { getApiKey, getProvider } from '@electron/utils/secure-storage';

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
      'openai-codex/gpt-5.3-codex',
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
});
