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
  installPresetAgent,
  listAgentPresetSummaries,
  listAgentsSnapshot,
  unmanageAgent,
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
  installPresetAgent: vi.fn(async () => ({
    agents: [{ id: 'stockexpert', managed: true }],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
  })),
  listAgentPresetSummaries: vi.fn(async () => [{
    presetId: 'stock-expert',
    name: '股票助手',
    platforms: ['darwin'],
    supportedOnCurrentPlatform: true,
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
  installPresetAgent,
  listAgentPresetSummaries,
  listAgentsSnapshot,
  unmanageAgent,
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

  it('serves bundled presets and installs them', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const listReq = { method: 'GET' } as never;
    const installReq = { method: 'POST' } as never;
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
        presetId: 'stock-expert',
        name: '股票助手',
        platforms: ['darwin'],
        supportedOnCurrentPlatform: true,
      }],
    }));

    parseJsonBody.mockResolvedValueOnce({ presetId: 'stock-expert' });
    await handleAgentRoutes(installReq, res, new URL('http://127.0.0.1/api/agents/presets/install'), ctx);

    expect(installPresetAgent).toHaveBeenCalledWith('stock-expert');
    expect(sendJson).toHaveBeenNthCalledWith(2, res, 200, expect.objectContaining({
      success: true,
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
