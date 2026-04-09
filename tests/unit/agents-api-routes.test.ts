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
  installMarketplaceAgent,
  listAgentPresetSummaries,
  listAgentsSnapshot,
  removeAgentWorkspaceDirectory,
  unmanageAgent,
  updateMarketplaceAgent,
  updateAgentName,
  updateAgentPersona,
  updateAgentSettings,
  updateDefaultAgentFallbacks,
} = vi.hoisted(() => ({
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  getAgentPersona: vi.fn(),
  getDefaultAgentModelConfig: vi.fn(),
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
  removeAgentWorkspaceDirectory: vi.fn(),
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
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  getAgentPersona,
  getDefaultAgentModelConfig,
  installMarketplaceAgent,
  listAgentPresetSummaries,
  listAgentsSnapshot,
  removeAgentWorkspaceDirectory,
  unmanageAgent,
  updateMarketplaceAgent,
  updateAgentName,
  updateAgentPersona,
  updateAgentSettings,
  updateDefaultAgentFallbacks,
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
      avatarPresetId: 'gradient-sunset',
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
      avatarPresetId: 'gradient-sunset',
      skillScope: {
        mode: 'specified',
        skills: ['stock-analyzer', 'web-search'],
      },
    });
  });

  it('forwards avatar preset selections when creating agents', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    parseJsonBody.mockResolvedValueOnce({
      name: 'Research Helper',
      id: 'research-helper',
      avatarPresetId: 'gradient-sky',
    });

    const handled = await handleAgentRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/agents'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(createAgent).toHaveBeenCalledWith('Research Helper', 'research-helper', 'gradient-sky');
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

  it('defers managed workspace deletion until after gateway restart when deleting an agent', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const removedEntry = { id: 'stockexpert', workspace: '~/geeclaw/workspace-stockexpert' };
    deleteAgentConfig.mockResolvedValueOnce({
      snapshot: {
        agents: [{ id: 'main' }],
        defaultAgentId: 'main',
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
        explicitChannelAccountBindings: {},
      },
      removedEntry,
    });

    const restart = vi.fn(async () => undefined);
    const handled = await handleAgentRoutes(
      { method: 'DELETE' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/agents/stockexpert'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running', pid: undefined, port: 28788 }),
          restart,
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(deleteAgentConfig).toHaveBeenCalledWith('stockexpert');
    expect(restart).toHaveBeenCalledTimes(1);
    expect(removeAgentWorkspaceDirectory).toHaveBeenCalledWith(removedEntry);
    expect(restart.mock.invocationCallOrder[0]).toBeLessThan(removeAgentWorkspaceDirectory.mock.invocationCallOrder[0]);
    expect(sendJson).toHaveBeenCalledWith({}, 200, {
      success: true,
      agents: [{ id: 'main' }],
      defaultAgentId: 'main',
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
      explicitChannelAccountBindings: {},
    });
  });
});
