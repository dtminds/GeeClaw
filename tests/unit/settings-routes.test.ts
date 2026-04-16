import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const applyProxySettingsMock = vi.fn();
const getAllSettingsMock = vi.fn();
const getSettingMock = vi.fn();
const resetSettingsMock = vi.fn();
const setSettingMock = vi.fn();
const buildOpenClawSafetySettingsMock = vi.fn();
const isToolPermissionMock = vi.fn();
const isApprovalPolicyMock = vi.fn();
const syncOpenClawSafetySettingsMock = vi.fn();
const getManagedAppEnvironmentEntriesMock = vi.fn();
const replaceManagedAppEnvironmentEntriesMock = vi.fn();
const resolveGeeClawAppEnvironmentMock = vi.fn();
const listWebSearchProviderDescriptorsMock = vi.fn();
const applyWebSearchSettingsPatchMock = vi.fn();
const buildWebSearchProviderAvailabilityMapMock = vi.fn();
const buildWebSearchProviderEnvVarStatusMapMock = vi.fn();
const deleteWebSearchProviderConfigMock = vi.fn();
const readWebSearchSettingsSnapshotMock = vi.fn();
const readMemorySettingsSnapshotMock = vi.fn();
const applyMemorySettingsPatchMock = vi.fn();
const installManagedPluginNowMock = vi.fn();
const readOpenClawConfigDocumentMock = vi.fn();
const mutateOpenClawConfigDocumentMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/main/proxy', () => ({
  applyProxySettings: (...args: unknown[]) => applyProxySettingsMock(...args),
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: (...args: unknown[]) => getAllSettingsMock(...args),
  getSetting: (...args: unknown[]) => getSettingMock(...args),
  resetSettings: (...args: unknown[]) => resetSettingsMock(...args),
  setSetting: (...args: unknown[]) => setSettingMock(...args),
}));

vi.mock('@electron/utils/openclaw-safety-settings', () => ({
  buildOpenClawSafetySettings: (...args: unknown[]) => buildOpenClawSafetySettingsMock(...args),
  isToolPermission: (...args: unknown[]) => isToolPermissionMock(...args),
  isApprovalPolicy: (...args: unknown[]) => isApprovalPolicyMock(...args),
  syncOpenClawSafetySettings: (...args: unknown[]) => syncOpenClawSafetySettingsMock(...args),
}));

vi.mock('@electron/utils/app-env', () => ({
  getManagedAppEnvironmentEntries: (...args: unknown[]) => getManagedAppEnvironmentEntriesMock(...args),
  replaceManagedAppEnvironmentEntries: (...args: unknown[]) => replaceManagedAppEnvironmentEntriesMock(...args),
  resolveGeeClawAppEnvironment: (...args: unknown[]) => resolveGeeClawAppEnvironmentMock(...args),
}));

vi.mock('@electron/utils/openclaw-web-search-provider-registry', () => ({
  listWebSearchProviderDescriptors: (...args: unknown[]) => listWebSearchProviderDescriptorsMock(...args),
}));

vi.mock('@electron/utils/openclaw-web-search-config', () => ({
  applyWebSearchSettingsPatch: (...args: unknown[]) => applyWebSearchSettingsPatchMock(...args),
  buildWebSearchProviderAvailabilityMap: (...args: unknown[]) => buildWebSearchProviderAvailabilityMapMock(...args),
  buildWebSearchProviderEnvVarStatusMap: (...args: unknown[]) => buildWebSearchProviderEnvVarStatusMapMock(...args),
  deleteWebSearchProviderConfig: (...args: unknown[]) => deleteWebSearchProviderConfigMock(...args),
  readWebSearchSettingsSnapshot: (...args: unknown[]) => readWebSearchSettingsSnapshotMock(...args),
}));

vi.mock('@electron/utils/openclaw-memory-settings', () => ({
  readMemorySettingsSnapshot: (...args: unknown[]) => readMemorySettingsSnapshotMock(...args),
  applyMemorySettingsPatch: (...args: unknown[]) => applyMemorySettingsPatchMock(...args),
}));

vi.mock('@electron/utils/managed-plugin-installer', () => ({
  installManagedPluginNow: (...args: unknown[]) => installManagedPluginNowMock(...args),
}));

vi.mock('@electron/utils/openclaw-config-coordinator', () => ({
  readOpenClawConfigDocument: (...args: unknown[]) => readOpenClawConfigDocumentMock(...args),
  mutateOpenClawConfigDocument: (...args: unknown[]) => mutateOpenClawConfigDocumentMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleSettingsRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getAllSettingsMock.mockResolvedValue({
      toolPermission: 'default',
      approvalPolicy: 'full',
    });
    buildOpenClawSafetySettingsMock.mockReturnValue({
      toolPermission: 'default',
      approvalPolicy: 'full',
    });
    isToolPermissionMock.mockImplementation((value: unknown) => (
      value === 'default' || value === 'strict' || value === 'full'
    ));
    isApprovalPolicyMock.mockImplementation((value: unknown) => (
      value === 'allowlist' || value === 'full'
    ));
    getManagedAppEnvironmentEntriesMock.mockResolvedValue([]);
    resolveGeeClawAppEnvironmentMock.mockResolvedValue({});
    listWebSearchProviderDescriptorsMock.mockReturnValue([]);
    applyWebSearchSettingsPatchMock.mockReturnValue(false);
    buildWebSearchProviderAvailabilityMapMock.mockReturnValue({});
    buildWebSearchProviderEnvVarStatusMapMock.mockReturnValue({});
    deleteWebSearchProviderConfigMock.mockReturnValue(false);
    readWebSearchSettingsSnapshotMock.mockReturnValue({
      search: {
        enabled: false,
      },
      providerConfigByProvider: {},
    });
    readMemorySettingsSnapshotMock.mockResolvedValue({
      dreaming: {
        enabled: false,
        status: 'disabled',
      },
      activeMemory: {
        enabled: false,
        model: null,
        modelMode: 'automatic',
        status: 'disabled',
      },
      losslessClaw: {
        enabled: false,
        installedVersion: null,
        requiredVersion: '0.5.2',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'not-installed',
        installJob: null,
      },
    });
    applyMemorySettingsPatchMock.mockResolvedValue(false);
    installManagedPluginNowMock.mockResolvedValue({
      action: 'installed',
      pluginId: 'lossless-claw',
      installedVersion: '0.9.1',
      previousVersion: null,
    });
    readOpenClawConfigDocumentMock.mockResolvedValue({});
    mutateOpenClawConfigDocumentMock.mockImplementation(async (
      mutate: (config: Record<string, unknown>) => Promise<{ changed: boolean; result: unknown }> | { changed: boolean; result: unknown },
    ) => {
      const config: Record<string, unknown> = {};
      const { result } = await mutate(config);
      return result;
    });
  });

  it('debounces a gateway reload after saving safety settings while running', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({ toolPermission: 'strict', approvalPolicy: 'allowlist' });
    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');

    const debouncedReload = vi.fn();
    const restart = vi.fn();
    const handled = await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/safety'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          restart,
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(setSettingMock).toHaveBeenCalledWith('toolPermission', 'strict');
    expect(setSettingMock).toHaveBeenCalledWith('approvalPolicy', 'allowlist');
    expect(syncOpenClawSafetySettingsMock).toHaveBeenCalledWith({
      toolPermission: 'default',
      approvalPolicy: 'full',
    });
    expect(debouncedReload).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('persists safety settings without scheduling reload when gateway is stopped', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({ approvalPolicy: 'allowlist' });
    getAllSettingsMock.mockResolvedValue({
      toolPermission: 'default',
      approvalPolicy: 'allowlist',
    });
    buildOpenClawSafetySettingsMock.mockReturnValue({
      toolPermission: 'default',
      approvalPolicy: 'allowlist',
    });
    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');

    const debouncedReload = vi.fn();
    const restart = vi.fn();
    await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/safety'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          debouncedReload,
          restart,
        },
      } as never,
    );

    expect(setSettingMock).toHaveBeenCalledWith('approvalPolicy', 'allowlist');
    expect(syncOpenClawSafetySettingsMock).toHaveBeenCalledWith({
      toolPermission: 'default',
      approvalPolicy: 'allowlist',
    });
    expect(debouncedReload).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it('reads and replaces managed app environment entries, restarting the gateway when running', async () => {
    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    getManagedAppEnvironmentEntriesMock.mockResolvedValueOnce([
      { key: 'NOTION_API_KEY', value: 'secret-notion' },
    ]);

    const res = {} as ServerResponse;
    await handleSettingsRoutes(
      { method: 'GET' } as IncomingMessage,
      res,
      new URL('http://127.0.0.1:13210/api/settings/environment'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          debouncedReload: vi.fn(),
          restart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, {
      entries: [{ key: 'NOTION_API_KEY', value: 'secret-notion' }],
    });

    parseJsonBodyMock.mockResolvedValueOnce({
      entries: [
        { key: 'NOTION_API_KEY', value: 'secret-notion' },
        { key: 'TAVILY_API_KEY', value: 'secret-tavily' },
      ],
    });

    const restart = vi.fn();
    await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      res,
      new URL('http://127.0.0.1:13210/api/settings/environment'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          restart,
        },
      } as never,
    );

    expect(replaceManagedAppEnvironmentEntriesMock).toHaveBeenCalledWith([
      { key: 'NOTION_API_KEY', value: 'secret-notion' },
      { key: 'TAVILY_API_KEY', value: 'secret-tavily' },
    ]);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenLastCalledWith(
      res,
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('returns the memory settings snapshot', async () => {
    readMemorySettingsSnapshotMock.mockResolvedValueOnce({
      dreaming: {
        enabled: true,
        status: 'enabled',
      },
      activeMemory: {
        enabled: true,
        model: 'openai/gpt-5.4-mini',
        modelMode: 'custom',
        status: 'enabled',
      },
      losslessClaw: {
        enabled: false,
        installedVersion: '0.5.2',
        requiredVersion: '0.5.2',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'disabled',
        installJob: null,
      },
    });

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');

    await handleSettingsRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/memory'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          debouncedReload: vi.fn(),
          restart: vi.fn(),
        },
      } as never,
    );

    expect(readMemorySettingsSnapshotMock).toHaveBeenCalledWith({});
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        dreaming: expect.objectContaining({ status: 'enabled' }),
        activeMemory: expect.objectContaining({ model: 'openai/gpt-5.4-mini' }),
      }),
    );
  });

  it('persists memory settings and debounces a gateway reload when config changed', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      dreaming: {
        enabled: true,
      },
      activeMemory: {
        enabled: true,
        model: 'openai/gpt-5.4-mini',
      },
    });
    applyMemorySettingsPatchMock.mockResolvedValueOnce(true);
    readMemorySettingsSnapshotMock.mockResolvedValueOnce({
      dreaming: {
        enabled: true,
        status: 'enabled',
      },
      activeMemory: {
        enabled: true,
        model: 'openai/gpt-5.4-mini',
        modelMode: 'custom',
        status: 'enabled',
      },
      losslessClaw: {
        enabled: false,
        installedVersion: null,
        requiredVersion: '0.5.2',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'not-installed',
        installJob: null,
      },
    });

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const debouncedReload = vi.fn();

    await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/memory'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          restart: vi.fn(),
        },
      } as never,
    );

    expect(mutateOpenClawConfigDocumentMock).toHaveBeenCalledTimes(1);
    expect(applyMemorySettingsPatchMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        dreaming: {
          enabled: true,
        },
      }),
    );
    expect(debouncedReload).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('starts lossless-claw installation on demand and returns the current memory snapshot', async () => {
    readMemorySettingsSnapshotMock.mockResolvedValueOnce({
      dreaming: {
        enabled: false,
        status: 'disabled',
      },
      activeMemory: {
        enabled: false,
        model: null,
        modelMode: 'automatic',
        status: 'disabled',
      },
      losslessClaw: {
        enabled: false,
        installedVersion: '0.9.1',
        requiredVersion: '0.9.1',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'disabled',
        installJob: null,
      },
    });

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const res = {} as ServerResponse;
    const restart = vi.fn();
    const debouncedReload = vi.fn();

    const handled = await handleSettingsRoutes(
      { method: 'POST' } as IncomingMessage,
      res,
      new URL('http://127.0.0.1:13210/api/settings/memory/lossless-claw/install'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          restart,
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(installManagedPluginNowMock).toHaveBeenCalledWith({ pluginId: 'lossless-claw' });
    expect(readOpenClawConfigDocumentMock).toHaveBeenCalledTimes(1);
    expect(readMemorySettingsSnapshotMock).toHaveBeenCalledWith({});
    expect(debouncedReload).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(res, 202, {
      success: true,
      settings: expect.objectContaining({
        losslessClaw: expect.objectContaining({
          installedVersion: '0.9.1',
          status: 'disabled',
        }),
      }),
    });
  });

  it('returns normalized web search provider descriptors', async () => {
    listWebSearchProviderDescriptorsMock.mockReturnValue([
      {
        providerId: 'duckduckgo',
        pluginId: 'duckduckgo',
        label: 'DuckDuckGo',
        availabilityKind: 'none',
        enablePluginOnSelect: true,
      },
      {
        providerId: 'ollama',
        pluginId: 'ollama',
        label: 'Ollama',
        availabilityKind: 'runtime',
        runtimeRequirementHint: 'Requires a running Ollama service.',
      },
    ]);
    buildWebSearchProviderAvailabilityMapMock.mockReturnValue({
      duckduckgo: {
        available: true,
        source: 'built-in',
      },
      ollama: {
        available: false,
        source: 'runtime-prereq',
      },
    });
    buildWebSearchProviderEnvVarStatusMapMock.mockReturnValue({
      duckduckgo: {},
      ollama: {},
    });

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');

    await handleSettingsRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/web-search/providers'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          debouncedReload: vi.fn(),
          restart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        providers: expect.arrayContaining([
          expect.objectContaining({
            providerId: 'duckduckgo',
            pluginId: 'duckduckgo',
            availability: {
              available: true,
              source: 'built-in',
            },
            availabilityKind: 'none',
            enablePluginOnSelect: true,
            envVarStatuses: {},
          }),
          expect.objectContaining({
            providerId: 'ollama',
            pluginId: 'ollama',
            availability: {
              available: false,
              source: 'runtime-prereq',
            },
            availabilityKind: 'runtime',
            runtimeRequirementHint: 'Requires a running Ollama service.',
            envVarStatuses: {},
          }),
        ]),
      }),
    );
  });

  it('persists web search config and debounces gateway reload when running', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      enabled: true,
      provider: 'perplexity',
      shared: {
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
      providerConfig: {
        providerId: 'perplexity',
        values: {
          apiKey: 'pplx-test',
          model: 'perplexity/sonar-pro',
        },
      },
    });
    applyWebSearchSettingsPatchMock.mockReturnValue(true);
    readWebSearchSettingsSnapshotMock.mockReturnValue({
      search: {
        enabled: true,
        provider: 'perplexity',
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
      providerConfigByProvider: {
        perplexity: {
          apiKey: 'pplx-test',
          model: 'perplexity/sonar-pro',
        },
      },
    });

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const debouncedReload = vi.fn();

    await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/web-search'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          restart: vi.fn(),
        },
      } as never,
    );

    expect(mutateOpenClawConfigDocumentMock).toHaveBeenCalledTimes(1);
    expect(applyWebSearchSettingsPatchMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        enabled: true,
        provider: 'perplexity',
      }),
    );
    expect(debouncedReload).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('does not debounce a gateway reload after saving web search config when nothing changed', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      enabled: true,
      provider: 'perplexity',
    });
    applyWebSearchSettingsPatchMock.mockReturnValue(false);

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const debouncedReload = vi.fn();

    await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/web-search'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          restart: vi.fn(),
        },
      } as never,
    );

    expect(applyWebSearchSettingsPatchMock).toHaveBeenCalledTimes(1);
    expect(debouncedReload).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('deletes web search provider config and debounces gateway reload when running', async () => {
    listWebSearchProviderDescriptorsMock.mockReturnValue([
      {
        providerId: 'minimax',
        pluginId: 'minimax',
        label: 'MiniMax',
      },
    ]);
    readWebSearchSettingsSnapshotMock
      .mockReturnValueOnce({
        search: {
          enabled: true,
        },
        providerConfigByProvider: {
          minimax: {
            apiKey: 'mm-test',
          },
        },
      })
      .mockReturnValueOnce({
        search: {
          enabled: true,
        },
        providerConfigByProvider: {},
      });
    deleteWebSearchProviderConfigMock.mockReturnValue(true);

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const debouncedReload = vi.fn();

    await handleSettingsRoutes(
      { method: 'DELETE' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/web-search/providers/minimax'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          restart: vi.fn(),
        },
      } as never,
    );

    expect(deleteWebSearchProviderConfigMock).toHaveBeenCalledWith(
      expect.any(Object),
      'minimax',
    );
    expect(debouncedReload).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('does not debounce a gateway reload after deleting web search provider config when nothing changed', async () => {
    listWebSearchProviderDescriptorsMock.mockReturnValue([
      {
        providerId: 'minimax',
        pluginId: 'minimax',
        label: 'MiniMax',
      },
    ]);
    readWebSearchSettingsSnapshotMock.mockReturnValue({
      search: {
        enabled: true,
      },
      providerConfigByProvider: {},
    });
    deleteWebSearchProviderConfigMock.mockReturnValue(false);

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const debouncedReload = vi.fn();

    await handleSettingsRoutes(
      { method: 'DELETE' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/web-search/providers/minimax'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          restart: vi.fn(),
        },
      } as never,
    );

    expect(deleteWebSearchProviderConfigMock).toHaveBeenCalledWith(
      expect.any(Object),
      'minimax',
    );
    expect(debouncedReload).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('blocks deleting config for the default web search provider', async () => {
    listWebSearchProviderDescriptorsMock.mockReturnValue([
      {
        providerId: 'minimax',
        pluginId: 'minimax',
        label: 'MiniMax',
      },
    ]);
    readWebSearchSettingsSnapshotMock.mockReturnValue({
      search: {
        enabled: true,
        provider: 'minimax',
      },
      providerConfigByProvider: {
        minimax: {
          apiKey: 'mm-test',
        },
      },
    });

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');

    await handleSettingsRoutes(
      { method: 'DELETE' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/settings/web-search/providers/minimax'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          restart: vi.fn(),
        },
      } as never,
    );

    expect(deleteWebSearchProviderConfigMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      409,
      expect.objectContaining({ success: false }),
    );
  });
});
