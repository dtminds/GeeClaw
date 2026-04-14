import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccount } from '@electron/shared/providers/types';
import type { DefaultAgentModelConfigSnapshot } from '@electron/utils/agent-config';

const {
  ensureProviderStoreMigratedMock,
  getProviderAccountMock,
  saveProviderAccountMock,
  saveProviderMock,
  storeApiKeyMock,
  getDefaultAgentModelConfigMock,
  updateDefaultAgentModelConfigMock,
} = vi.hoisted(() => ({
  ensureProviderStoreMigratedMock: vi.fn(),
  getProviderAccountMock: vi.fn(),
  saveProviderAccountMock: vi.fn(),
  saveProviderMock: vi.fn(),
  storeApiKeyMock: vi.fn(),
  getDefaultAgentModelConfigMock: vi.fn(),
  updateDefaultAgentModelConfigMock: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-migration', () => ({
  ensureProviderStoreMigrated: (...args: unknown[]) => ensureProviderStoreMigratedMock(...args),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getDefaultProviderAccountId: vi.fn(),
  getProviderAccount: (...args: unknown[]) => getProviderAccountMock(...args),
  listProviderAccounts: vi.fn(),
  providerAccountToConfig: vi.fn((account: ProviderAccount) => ({
    id: account.id,
    type: account.vendorId,
    name: account.label,
    model: account.model,
    models: account.models,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  })),
  providerConfigToAccount: vi.fn(),
  saveProviderAccount: (...args: unknown[]) => saveProviderAccountMock(...args),
  setDefaultProviderAccount: vi.fn(),
}));

vi.mock('@electron/utils/secure-storage', () => ({
  deleteApiKey: vi.fn(),
  deleteProvider: vi.fn(),
  getApiKey: vi.fn(),
  hasApiKey: vi.fn(),
  saveProvider: (...args: unknown[]) => saveProviderMock(...args),
  setDefaultProvider: vi.fn(),
  storeApiKey: (...args: unknown[]) => storeApiKeyMock(...args),
}));

vi.mock('@electron/utils/agent-config', () => ({
  getDefaultAgentModelConfig: (...args: unknown[]) => getDefaultAgentModelConfigMock(...args),
  updateDefaultAgentModelConfig: (...args: unknown[]) => updateDefaultAgentModelConfigMock(...args),
}));

function buildDefaultModelSnapshot(
  overrides?: Partial<DefaultAgentModelConfigSnapshot>,
): DefaultAgentModelConfigSnapshot {
  return {
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
    availableModels: [],
    ...overrides,
  };
}

describe('ProviderService.createAccount', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    ensureProviderStoreMigratedMock.mockResolvedValue(undefined);
    saveProviderMock.mockResolvedValue(undefined);
    saveProviderAccountMock.mockResolvedValue(undefined);
    storeApiKeyMock.mockResolvedValue(undefined);
    getProviderAccountMock.mockResolvedValue(null);
    getDefaultAgentModelConfigMock.mockResolvedValue(buildDefaultModelSnapshot());
    updateDefaultAgentModelConfigMock.mockResolvedValue(buildDefaultModelSnapshot({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: [],
      },
      primary: 'openai/gpt-5.4',
    }));
  });

  it('seeds the default chat model from the first configured provider model when chat model is empty', async () => {
    const { ProviderService } = await import('@electron/services/providers/provider-service');
    const service = new ProviderService();

    await service.createAccount({
      id: 'openai',
      vendorId: 'openai',
      label: 'OpenAI',
      authMode: 'api_key',
      models: ['gpt-5.4', 'gpt-5.4-mini'],
      enabled: true,
      isDefault: false,
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });

    expect(updateDefaultAgentModelConfigMock).toHaveBeenCalledWith({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
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
    });
  });

  it('seeds the default chat model from the first structured provider model entry', async () => {
    const { ProviderService } = await import('@electron/services/providers/provider-service');
    const service = new ProviderService();

    await service.createAccount({
      id: 'openai',
      vendorId: 'openai',
      label: 'OpenAI',
      authMode: 'api_key',
      models: [
        {
          id: 'gpt-5.4',
          name: 'gpt-5.4',
          reasoning: false,
          input: ['text', 'image'],
          contextWindow: 200000,
        },
        {
          id: 'gpt-5.4-mini',
          name: 'gpt-5.4-mini',
          reasoning: false,
        },
      ],
      enabled: true,
      isDefault: false,
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });

    expect(updateDefaultAgentModelConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: [],
      },
    }));
  });

  it('does not overwrite an explicit chat model when adding another provider', async () => {
    const { ProviderService } = await import('@electron/services/providers/provider-service');
    const service = new ProviderService();
    getDefaultAgentModelConfigMock.mockResolvedValueOnce(buildDefaultModelSnapshot({
      model: {
        configured: true,
        primary: 'anthropic/claude-sonnet-4-5',
        fallbacks: [],
      },
      primary: 'anthropic/claude-sonnet-4-5',
    }));

    await service.createAccount({
      id: 'openai',
      vendorId: 'openai',
      label: 'OpenAI',
      authMode: 'api_key',
      models: ['gpt-5.4'],
      enabled: true,
      isDefault: false,
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });

    expect(updateDefaultAgentModelConfigMock).not.toHaveBeenCalled();
  });

  it('skips seeding when the provider has no configured models', async () => {
    const { ProviderService } = await import('@electron/services/providers/provider-service');
    const service = new ProviderService();

    await service.createAccount({
      id: 'openai',
      vendorId: 'openai',
      label: 'OpenAI',
      authMode: 'api_key',
      models: [],
      enabled: true,
      isDefault: false,
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });

    expect(updateDefaultAgentModelConfigMock).not.toHaveBeenCalled();
  });
});
