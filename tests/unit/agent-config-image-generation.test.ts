import { beforeEach, describe, expect, it, vi } from 'vitest';

const readOpenClawConfig = vi.fn();
const saveAgentRuntimeConfigToStore = vi.fn();
const syncAllAgentConfigToOpenClaw = vi.fn();
const listProviderAccounts = vi.fn();
const providerAccountToConfig = vi.fn();
const getProviderSecret = vi.fn();

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getAppPath: () => '/tmp/app',
    getName: () => 'GeeClaw',
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('@electron/utils/channel-config', () => ({
  listConfiguredChannels: vi.fn(async () => []),
  readOpenClawConfig: (...args: unknown[]) => readOpenClawConfig(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getOpenClawConfigDir: () => '/tmp/.openclaw-geeclaw',
}));

vi.mock('@electron/utils/managed-agent-workspace', () => ({
  getManagedAgentDirPath: (agentId: string) => `/tmp/agents/${agentId}`,
  getManagedAgentWorkspacePath: (agentId: string) => `/tmp/workspaces/${agentId}`,
  resolveManagedAgentWorkspacePath: (agentId: string) => `/tmp/workspaces/${agentId}`,
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: (...args: unknown[]) => listProviderAccounts(...args),
  providerAccountToConfig: (...args: unknown[]) => providerAccountToConfig(...args),
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: (...args: unknown[]) => getProviderSecret(...args),
}));

vi.mock('@electron/services/agents/store-instance', () => ({
  getGeeClawAgentStore: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock('@electron/services/agents/agent-runtime-sync', () => ({
  saveAgentRuntimeConfigToStore: (...args: unknown[]) => saveAgentRuntimeConfigToStore(...args),
  syncAllAgentConfigToOpenClaw: (...args: unknown[]) => syncAllAgentConfigToOpenClaw(...args),
}));

vi.mock('@electron/utils/agent-preset-platforms', () => ({
  formatPresetPlatforms: vi.fn(() => ''),
  isPresetSupportedOnPlatform: vi.fn(() => true),
}));

vi.mock('@electron/utils/desktop-sessions', () => ({
  deleteDesktopSessionsForAgent: vi.fn(async () => {}),
}));

vi.mock('@electron/utils/agent-marketplace-installer', () => ({
  getAgentMarketplaceCatalogEntry: vi.fn(),
  prepareAgentMarketplacePackage: vi.fn(),
}));

vi.mock('@electron/utils/agent-marketplace-catalog', () => ({
  loadAgentMarketplaceCatalog: vi.fn(async () => []),
}));

vi.mock('@electron/utils/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

describe('image generation model config', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    readOpenClawConfig.mockResolvedValue({
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.4',
            fallbacks: ['openai/gpt-5-mini'],
          },
        },
      },
    });

    listProviderAccounts.mockResolvedValue([
      {
        id: 'openai-account',
        vendorId: 'openai',
        label: 'OpenAI',
        enabled: true,
      },
      {
        id: 'fal-account',
        vendorId: 'fal',
        label: 'fal',
        enabled: true,
      },
      {
        id: 'google-account',
        vendorId: 'google',
        label: 'Google',
        enabled: true,
      },
    ]);

    providerAccountToConfig.mockImplementation((account: {
      id: string;
      vendorId: string;
      label: string;
      enabled: boolean;
    }) => ({
      id: account.id,
      type: account.vendorId,
      name: account.label,
      enabled: account.enabled,
    }));

    getProviderSecret.mockImplementation(async (accountId: string) => (
      accountId === 'openai-account'
        ? { type: 'api_key', accountId, apiKey: 'sk-openai' }
        : null
    ));
  });

  it('reports auto mode and inferred effective model when config is absent', async () => {
    const { getImageGenerationModelConfig } = await import('@electron/utils/agent-config');

    await expect(getImageGenerationModelConfig()).resolves.toEqual(
      expect.objectContaining({
        mode: 'auto',
        primary: null,
        fallbacks: [],
        effective: {
          source: 'inferred',
          primary: 'openai/gpt-image-1',
        },
        availableProviders: expect.arrayContaining([
          expect.objectContaining({
            providerId: 'openai-account',
            providerName: 'OpenAI',
            authConfigured: true,
            defaultModelRef: 'openai/gpt-image-1',
          }),
        ]),
      }),
    );
  });

  it('writes canonical manual config and preserves fallback order', async () => {
    const { updateImageGenerationModelConfig } = await import('@electron/utils/agent-config');

    await expect(
      updateImageGenerationModelConfig({
        mode: 'manual',
        primary: 'google/gemini-3-pro-image-preview',
        fallbacks: ['fal/fal-ai/flux/dev'],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        mode: 'manual',
        primary: 'google/gemini-3-pro-image-preview',
        fallbacks: ['fal/fal-ai/flux/dev'],
        effective: {
          source: 'manual',
          primary: 'google/gemini-3-pro-image-preview',
        },
      }),
    );

    expect(saveAgentRuntimeConfigToStore).toHaveBeenCalledWith(expect.objectContaining({
      agents: expect.objectContaining({
        defaults: expect.objectContaining({
          imageGenerationModel: {
            primary: 'google/gemini-3-pro-image-preview',
            fallbacks: ['fal/fal-ai/flux/dev'],
          },
        }),
      }),
    }));
    expect(syncAllAgentConfigToOpenClaw).toHaveBeenCalledTimes(1);
  });

  it('removes imageGenerationModel when saving auto mode', async () => {
    readOpenClawConfig.mockResolvedValueOnce({
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.4',
          },
          imageGenerationModel: {
            primary: 'google/gemini-3-pro-image-preview',
            fallbacks: ['fal/fal-ai/flux/dev'],
          },
        },
      },
    });

    const { updateImageGenerationModelConfig } = await import('@electron/utils/agent-config');

    await expect(
      updateImageGenerationModelConfig({
        mode: 'auto',
        primary: null,
        fallbacks: [],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        mode: 'auto',
        primary: null,
        fallbacks: [],
      }),
    );

    expect(saveAgentRuntimeConfigToStore).toHaveBeenCalledWith(expect.objectContaining({
      agents: expect.objectContaining({
        defaults: expect.not.objectContaining({
          imageGenerationModel: expect.anything(),
        }),
      }),
    }));
  });
});
