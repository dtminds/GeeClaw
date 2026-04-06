import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseJsonBody = vi.fn();
const sendJson = vi.fn();

const {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  getAgentPersona,
  getDefaultAgentModelConfig,
  getImageGenerationModelConfig,
  installMarketplaceAgent,
  listAgentPresetSummaries,
  listAgentsSnapshot,
  unmanageAgent,
  updateMarketplaceAgent,
  updateAgentName,
  updateAgentPersona,
  updateAgentSettings,
  updateDefaultAgentFallbacks,
  updateImageGenerationModelConfig,
} = vi.hoisted(() => ({
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  getAgentPersona: vi.fn(),
  getDefaultAgentModelConfig: vi.fn(),
  getImageGenerationModelConfig: vi.fn(),
  installMarketplaceAgent: vi.fn(async () => ({
    completion: {
      operation: 'install',
      agentId: 'stockexpert',
      promptText: 'Please review the installed workspace.',
    },
    agents: [{ id: 'stockexpert', managed: true }],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
  })),
  listAgentPresetSummaries: vi.fn(async () => [{
    source: 'marketplace',
    agentId: 'stockexpert',
    name: '股票助手',
    platforms: ['darwin'],
    latestVersion: '1.2.3',
    installed: false,
    hasUpdate: false,
    installable: true,
    supportedOnCurrentPlatform: true,
    supportedOnCurrentAppVersion: true,
    managed: true,
    description: 'desc',
    emoji: '📈',
    category: 'finance',
    skillScope: { mode: 'default' },
    presetSkills: [],
    managedFiles: [],
  }]),
  listAgentsSnapshot: vi.fn(async () => ({
    agents: [],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
  })),
  unmanageAgent: vi.fn(async () => ({
    agents: [{ id: 'stockexpert', managed: false }],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
  })),
  updateMarketplaceAgent: vi.fn(async () => ({
    completion: {
      operation: 'update',
      agentId: 'stockexpert',
      promptText: 'Please summarize what changed.',
    },
    agents: [{ id: 'stockexpert', managed: true }],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
  })),
  updateAgentName: vi.fn(),
  updateAgentPersona: vi.fn(),
  updateAgentSettings: vi.fn(async () => ({
    agents: [{ id: 'stockexpert', managed: true }],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
  })),
  updateDefaultAgentFallbacks: vi.fn(),
  updateImageGenerationModelConfig: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  getAgentPersona,
  getDefaultAgentModelConfig,
  getImageGenerationModelConfig,
  installMarketplaceAgent,
  listAgentPresetSummaries,
  listAgentsSnapshot,
  unmanageAgent,
  updateMarketplaceAgent,
  updateAgentName,
  updateAgentPersona,
  updateAgentSettings,
  updateDefaultAgentFallbacks,
  updateImageGenerationModelConfig,
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBody(...args),
  sendJson: (...args: unknown[]) => sendJson(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => '/tmp'),
}));

describe('agent API routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('serves marketplace summaries but does not expose the removed preset install POST route', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const listReq = { method: 'GET' } as never;
    const res = {} as never;
    const ctx = {
      gatewayManager: {
        getStatus: () => ({ state: 'stopped' }),
        debouncedReload: vi.fn(),
      },
    } as never;

    await handleAgentRoutes(listReq, res, new URL('http://127.0.0.1/api/agents/presets'), ctx);
    expect(listAgentPresetSummaries).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenNthCalledWith(1, res, 200, expect.objectContaining({
      success: true,
      presets: [{
        source: 'marketplace',
        agentId: 'stockexpert',
        name: '股票助手',
        platforms: ['darwin'],
        latestVersion: '1.2.3',
        installed: false,
        hasUpdate: false,
        installable: true,
        supportedOnCurrentPlatform: true,
        supportedOnCurrentAppVersion: true,
        managed: true,
        description: 'desc',
        emoji: '📈',
        category: 'finance',
        skillScope: { mode: 'default' },
        presetSkills: [],
        managedFiles: [],
      }],
    }));

    await expect(handleAgentRoutes(
      { method: 'POST' } as never,
      res,
      new URL('http://127.0.0.1/api/agents/presets/install'),
      ctx,
    )).resolves.toBe(false);
    expect(parseJsonBody).not.toHaveBeenCalled();
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  it('installs and updates marketplace agents with completion payloads', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const req = { method: 'POST' } as never;
    const res = {} as never;
    const ctx = {
      gatewayManager: {
        getStatus: () => ({ state: 'running' }),
        debouncedReload: vi.fn(),
      },
    } as never;

    parseJsonBody.mockResolvedValueOnce({ agentId: 'stockexpert' });
    await handleAgentRoutes(req, res, new URL('http://127.0.0.1/api/agents/marketplace/install'), ctx);

    expect(installMarketplaceAgent).toHaveBeenCalledWith('stockexpert');
    expect(sendJson).toHaveBeenNthCalledWith(1, res, 200, expect.objectContaining({
      success: true,
      completion: {
        operation: 'install',
        agentId: 'stockexpert',
        promptText: 'Please review the installed workspace.',
      },
      agents: [{ id: 'stockexpert', managed: true }],
    }));

    parseJsonBody.mockResolvedValueOnce({ agentId: 'stockexpert' });
    await handleAgentRoutes(req, res, new URL('http://127.0.0.1/api/agents/marketplace/update'), ctx);

    expect(updateMarketplaceAgent).toHaveBeenCalledWith('stockexpert');
    expect(sendJson).toHaveBeenNthCalledWith(2, res, 200, expect.objectContaining({
      success: true,
      completion: {
        operation: 'update',
        agentId: 'stockexpert',
        promptText: 'Please summarize what changed.',
      },
      agents: [{ id: 'stockexpert', managed: true }],
    }));
  });

  it('updates structured agent settings payloads', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    parseJsonBody.mockResolvedValueOnce({
      name: '股票助手 Pro',
      skillScope: {
        mode: 'specified',
        skills: ['stock-analyzer', 'web-search'],
      },
    });

    const handled = await handleAgentRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/agents/stockexpert'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(updateAgentSettings).toHaveBeenCalledWith('stockexpert', {
      name: '股票助手 Pro',
      skillScope: {
        mode: 'specified',
        skills: ['stock-analyzer', 'web-search'],
      },
    });
  });

  it('serves and updates image generation model config', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const res = {} as never;
    const ctx = {
      gatewayManager: {
        getStatus: () => ({ state: 'running' }),
        debouncedReload: vi.fn(),
      },
    } as never;

    getImageGenerationModelConfig.mockResolvedValue({
      mode: 'auto',
      primary: null,
      fallbacks: [],
      effective: { source: 'inferred', primary: 'openai/gpt-image-1' },
      availableProviders: [],
    });

    await handleAgentRoutes(
      { method: 'GET' } as never,
      res,
      new URL('http://127.0.0.1/api/agents/image-generation-model'),
      ctx,
    );

    expect(sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        success: true,
        mode: 'auto',
        effective: { source: 'inferred', primary: 'openai/gpt-image-1' },
      }),
    );

    parseJsonBody.mockResolvedValueOnce({
      mode: 'manual',
      primary: 'google/gemini-3-pro-image-preview',
      fallbacks: ['fal/fal-ai/flux/dev'],
    });
    updateImageGenerationModelConfig.mockResolvedValue({
      mode: 'manual',
      primary: 'google/gemini-3-pro-image-preview',
      fallbacks: ['fal/fal-ai/flux/dev'],
      effective: { source: 'manual', primary: 'google/gemini-3-pro-image-preview' },
      availableProviders: [],
    });

    await handleAgentRoutes(
      { method: 'PUT' } as never,
      res,
      new URL('http://127.0.0.1/api/agents/image-generation-model'),
      ctx,
    );

    expect(updateImageGenerationModelConfig).toHaveBeenCalledWith({
      mode: 'manual',
      primary: 'google/gemini-3-pro-image-preview',
      fallbacks: ['fal/fal-ai/flux/dev'],
    });
    expect(sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        success: true,
        mode: 'manual',
      }),
    );
    expect(ctx.gatewayManager.debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('unmanages preset agents through the dedicated route', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const handled = await handleAgentRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/agents/stockexpert/unmanage'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(unmanageAgent).toHaveBeenCalledWith('stockexpert');
  });
});
