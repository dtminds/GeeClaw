import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const {
  parseJsonBodyMock,
  sendJsonMock,
  getDefaultAgentModelConfigMock,
  getOpenClawProviderKeyForTypeMock,
  getProviderServiceMock,
  syncDeletedProviderApiKeyToRuntimeMock,
  syncAllAgentConfigToOpenClawMock,
  syncUpdatedProviderToRuntimeMock,
} = vi.hoisted(() => ({
  parseJsonBodyMock: vi.fn(),
  sendJsonMock: vi.fn(),
  getDefaultAgentModelConfigMock: vi.fn(),
  getOpenClawProviderKeyForTypeMock: vi.fn(),
  getProviderServiceMock: vi.fn(),
  syncDeletedProviderApiKeyToRuntimeMock: vi.fn(),
  syncAllAgentConfigToOpenClawMock: vi.fn(),
  syncUpdatedProviderToRuntimeMock: vi.fn(),
}));

const providerServiceStub = {
  listVendors: vi.fn(),
  listAccounts: vi.fn(),
  createAccount: vi.fn(),
  getDefaultAccountId: vi.fn(),
  setDefaultAccount: vi.fn(),
  getAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  deleteLegacyProviderApiKey: vi.fn(),
  listLegacyProvidersWithKeyInfo: vi.fn(),
  getDefaultLegacyProvider: vi.fn(),
  setDefaultLegacyProvider: vi.fn(),
  getLegacyProvider: vi.fn(),
};

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: (...args: unknown[]) => getProviderServiceMock(...args),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncDefaultProviderToRuntime: vi.fn(),
  syncDeletedProviderApiKeyToRuntime: (...args: unknown[]) => syncDeletedProviderApiKeyToRuntimeMock(...args),
  syncDeletedProviderToRuntime: vi.fn(),
  syncProviderApiKeyToRuntime: vi.fn(),
  syncSavedProviderToRuntime: vi.fn(),
  syncUpdatedProviderToRuntime: (...args: unknown[]) => syncUpdatedProviderToRuntimeMock(...args),
}));

vi.mock('@electron/services/agents/agent-runtime-sync', () => ({
  syncAllAgentConfigToOpenClaw: (...args: unknown[]) => syncAllAgentConfigToOpenClawMock(...args),
}));

vi.mock('@electron/services/providers/provider-validation', () => ({
  validateApiKeyWithProvider: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  providerAccountToConfig: vi.fn((account: unknown) => account),
}));

vi.mock('@electron/utils/agent-config', () => ({
  getDefaultAgentModelConfig: (...args: unknown[]) => getDefaultAgentModelConfigMock(...args),
}));

vi.mock('@electron/utils/provider-keys', () => ({
  getOpenClawProviderKeyForType: (...args: unknown[]) => getOpenClawProviderKeyForTypeMock(...args),
}));

describe('handleProviderRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.values(providerServiceStub).forEach((mockFn) => {
      mockFn.mockReset();
    });
    getProviderServiceMock.mockReturnValue(providerServiceStub);
    syncDeletedProviderApiKeyToRuntimeMock.mockReset();
    syncAllAgentConfigToOpenClawMock.mockReset();
    syncUpdatedProviderToRuntimeMock.mockReset();
    getOpenClawProviderKeyForTypeMock.mockReturnValue('openai');
    getDefaultAgentModelConfigMock.mockResolvedValue({
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
    });
  });

  it('blocks provider deletion when any configured model slot references that provider', async () => {
    const { handleProviderRoutes } = await import('@electron/api/routes/providers');
    providerServiceStub.getAccount.mockResolvedValueOnce({
      id: 'openai',
      vendorId: 'openai',
      authMode: 'api_key',
    });
    getDefaultAgentModelConfigMock.mockResolvedValueOnce({
      model: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      imageModel: {
        configured: true,
        primary: 'openai/gpt-4.1-mini',
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
        configured: true,
        primary: null,
        fallbacks: ['openai/sora-2'],
      },
      primary: null,
      fallbacks: [],
      availableModels: [],
    });

    const handled = await handleProviderRoutes(
      { method: 'DELETE' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/provider-accounts/openai'),
      { gatewayManager: {} } as never,
    );

    expect(handled).toBe(true);
    expect(providerServiceStub.deleteAccount).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        blockedByFallback: true,
        blockingRefs: ['openai/gpt-4.1-mini', 'openai/sora-2'],
        error: 'BLOCKED_BY_FALLBACK:openai/gpt-4.1-mini,openai/sora-2',
      }),
    );
  });

  it('blocks provider updates that would remove a referenced model ref', async () => {
    const { handleProviderRoutes } = await import('@electron/api/routes/providers');
    providerServiceStub.getAccount.mockResolvedValueOnce({
      id: 'openrouter',
      vendorId: 'openrouter',
      authMode: 'api_key',
      label: 'OpenRouter',
      models: [],
      metadata: {
        modelCatalog: {
          disabledBuiltinModelIds: [],
          disabledCustomModelIds: [],
          builtinModelOverrides: [],
          customModels: [{ id: 'google/gemini-3-flash-preview', name: 'google/gemini-3-flash-preview', reasoning: false }],
        },
      },
      enabled: true,
      isDefault: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    });
    getOpenClawProviderKeyForTypeMock.mockReturnValueOnce('openrouter');
    getDefaultAgentModelConfigMock.mockResolvedValueOnce({
      model: {
        configured: true,
        primary: 'openrouter/google/gemini-3-flash-preview',
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
      primary: 'openrouter/google/gemini-3-flash-preview',
      fallbacks: [],
      availableModels: [],
    });
    parseJsonBodyMock.mockResolvedValueOnce({
      updates: {
        metadata: {
          modelCatalog: {
            disabledBuiltinModelIds: [],
            disabledCustomModelIds: [],
            builtinModelOverrides: [],
            customModels: [],
          },
        },
      },
    });

    const handled = await handleProviderRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/provider-accounts/openrouter'),
      { gatewayManager: {} } as never,
    );

    expect(handled).toBe(true);
    expect(providerServiceStub.updateAccount).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        blockedByFallback: true,
        blockingRefs: ['openrouter/google/gemini-3-flash-preview'],
        error: 'BLOCKED_BY_FALLBACK:openrouter/google/gemini-3-flash-preview',
      }),
    );
  });

  it('rebuilds derived default model exports after provider account updates', async () => {
    const { handleProviderRoutes } = await import('@electron/api/routes/providers');
    providerServiceStub.getAccount.mockResolvedValueOnce({
      id: 'openrouter',
      vendorId: 'openrouter',
      authMode: 'api_key',
      metadata: {},
    });
    providerServiceStub.updateAccount.mockResolvedValueOnce({
      id: 'openrouter',
      vendorId: 'openrouter',
      authMode: 'api_key',
      metadata: {
        modelCatalog: {
          disabledBuiltinModelIds: ['openai/gpt-5.4'],
          disabledCustomModelIds: [],
          builtinModelOverrides: [],
          customModels: [],
        },
      },
    });
    getOpenClawProviderKeyForTypeMock.mockReturnValueOnce('openrouter');
    parseJsonBodyMock.mockResolvedValueOnce({
      updates: {
        metadata: {
          modelCatalog: {
            disabledBuiltinModelIds: ['openai/gpt-5.4'],
            disabledCustomModelIds: [],
            builtinModelOverrides: [],
            customModels: [],
          },
        },
      },
    });

    const handled = await handleProviderRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/provider-accounts/openrouter'),
      { gatewayManager: {} } as never,
    );

    expect(handled).toBe(true);
    expect(syncUpdatedProviderToRuntimeMock).toHaveBeenCalledTimes(1);
    expect(syncAllAgentConfigToOpenClawMock).toHaveBeenCalledTimes(1);
  });

  it('passes gatewayManager when deleting only a legacy provider api key', async () => {
    const { handleProviderRoutes } = await import('@electron/api/routes/providers');
    const gatewayManager = { name: 'gateway-manager' };
    providerServiceStub.getLegacyProvider.mockResolvedValueOnce({
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      enabled: true,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    });

    const handled = await handleProviderRoutes(
      { method: 'DELETE' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/providers/openai?apiKeyOnly=1'),
      { gatewayManager } as never,
    );

    expect(handled).toBe(true);
    expect(providerServiceStub.deleteLegacyProviderApiKey).toHaveBeenCalledWith('openai');
    expect(syncDeletedProviderApiKeyToRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai', type: 'openai' }),
      'openai',
      undefined,
      gatewayManager,
    );
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
  });
});
