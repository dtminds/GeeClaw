import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const {
  parseJsonBodyMock,
  sendJsonMock,
  getDefaultAgentModelConfigMock,
  getOpenClawProviderKeyForTypeMock,
  getProviderServiceMock,
} = vi.hoisted(() => ({
  parseJsonBodyMock: vi.fn(),
  sendJsonMock: vi.fn(),
  getDefaultAgentModelConfigMock: vi.fn(),
  getOpenClawProviderKeyForTypeMock: vi.fn(),
  getProviderServiceMock: vi.fn(),
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
  syncDeletedProviderApiKeyToRuntime: vi.fn(),
  syncDeletedProviderToRuntime: vi.fn(),
  syncProviderApiKeyToRuntime: vi.fn(),
  syncSavedProviderToRuntime: vi.fn(),
  syncUpdatedProviderToRuntime: vi.fn(),
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
});
