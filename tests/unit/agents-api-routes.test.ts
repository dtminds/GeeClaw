import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const parseJsonBody = vi.fn();
const sendJson = vi.fn();
const getOpenClawConfigDir = vi.fn(() => '/tmp');

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
  updateDefaultAgentModelConfig,
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
    agents: [{ id: 'stockexpert', managed: true, manualSkills: ['stock-analyzer'] }],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
  })),
  updateDefaultAgentModelConfig: vi.fn(),
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
  updateDefaultAgentModelConfig,
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBody(...args),
  sendJson: (...args: unknown[]) => sendJson(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => getOpenClawConfigDir(),
}));

describe('agent API routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getOpenClawConfigDir.mockReturnValue('/tmp');
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

  it('updates the full default model config and schedules a gateway reload', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const res = {} as never;
    const debouncedReload = vi.fn();
    parseJsonBody.mockResolvedValueOnce({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: ['openai/gpt-5.4-mini'],
      },
      imageModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      pdfModel: {
        configured: true,
        primary: 'openrouter/qwen/qwen-2.5-vl-72b-instruct:free',
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: true,
        primary: 'openai/gpt-image-1',
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
    });
    updateDefaultAgentModelConfig.mockResolvedValueOnce({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: ['openai/gpt-5.4-mini'],
      },
      imageModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      pdfModel: {
        configured: true,
        primary: 'openrouter/qwen/qwen-2.5-vl-72b-instruct:free',
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: true,
        primary: 'openai/gpt-image-1',
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      availableModels: [],
    });

    const handled = await handleAgentRoutes(
      { method: 'PUT' } as never,
      res,
      new URL('http://127.0.0.1/api/agents/default-model'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(updateDefaultAgentModelConfig).toHaveBeenCalledWith({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: ['openai/gpt-5.4-mini'],
      },
      imageModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      pdfModel: {
        configured: true,
        primary: 'openrouter/qwen/qwen-2.5-vl-72b-instruct:free',
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: true,
        primary: 'openai/gpt-image-1',
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
    });
    expect(debouncedReload).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      success: true,
      model: expect.objectContaining({
        primary: 'openai/gpt-5.4',
      }),
    }));
  });

  it('updates structured agent settings payloads', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    parseJsonBody.mockResolvedValueOnce({
      name: '股票助手 Pro',
      avatarPresetId: 'gradient-sunset',
      activeMemoryEnabled: true,
      activeEvolutionEnabled: true,
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
      activeMemoryEnabled: true,
      activeEvolutionEnabled: true,
      skillScope: {
        mode: 'specified',
        skills: ['stock-analyzer', 'web-search'],
      },
    });
  });

  it('forwards explicit manualSkills payloads for agent-scoped skill membership updates', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    parseJsonBody.mockResolvedValueOnce({
      manualSkills: ['pdf', 'xlsx'],
    });

    const handled = await handleAgentRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/agents/main'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(updateAgentSettings).toHaveBeenCalledWith('main', {
      name: undefined,
      avatarPresetId: undefined,
      activeMemoryEnabled: undefined,
      activeEvolutionEnabled: undefined,
      manualSkills: ['pdf', 'xlsx'],
      skillScope: undefined,
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

  it('builds agent session suggestions from channel defaults instead of session history', async () => {
    const openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-agent-sessions-'));
    getOpenClawConfigDir.mockReturnValue(openclawConfigDir);

    const sessionsDir = join(openclawConfigDir, 'agents', 'main', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(openclawConfigDir, 'channel-defaults.json'), JSON.stringify({
      main: {
        wecom: {
          default: { to: 'T48250041A' },
          work: { to: 'T9ABCDEFG' },
        },
      },
      'agent-sales': {
        wecom: {
          default: { to: 'TSALES001' },
        },
      },
    }), 'utf-8');
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      'agent:main:wecom:direct:jiajie.yu': {
        sessionId: 'history-session',
        chatType: 'direct',
        deliveryContext: { channel: 'wecom', accountId: 'bot-a' },
        origin: { label: 'WeCom DM', accountId: 'bot-a' },
        sessionFile: join(sessionsDir, 'history-session.jsonl'),
      },
    }), 'utf-8');
    writeFileSync(join(sessionsDir, 'history-session.jsonl'), `${JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: [
            'Sender (untrusted metadata):',
            '```json',
            JSON.stringify({ label: 'Jiajie Yu', id: 'jiajie.yu' }, null, 2),
            '```',
            '',
            '[WeCom 2026-04-27 12:00] hello',
          ].join('\n'),
        }],
      },
    })}\n`, 'utf-8');

    const { handleAgentRoutes } = await import('@electron/api/routes/agents');
    const res = {} as never;

    try {
      const handled = await handleAgentRoutes(
        { method: 'GET' } as never,
        res,
        new URL('http://127.0.0.1/api/agents/main/sessions'),
        {
          gatewayManager: {
            getStatus: () => ({ state: 'stopped' }),
            debouncedReload: vi.fn(),
          },
        } as never,
      );

      expect(handled).toBe(true);
      expect(sendJson).toHaveBeenCalledWith(res, 200, {
        success: true,
        sessions: [
          {
            sessionKey: 'agent:main:wecom:default',
            label: 'T48250041A',
            channel: 'wecom',
            to: 'T48250041A',
            accountId: 'default',
            chatType: 'direct',
          },
          {
            sessionKey: 'agent:main:wecom:work',
            label: 'T9ABCDEFG',
            channel: 'wecom',
            to: 'T9ABCDEFG',
            accountId: 'work',
            chatType: 'direct',
          },
        ],
      });
    } finally {
      rmSync(openclawConfigDir, { recursive: true, force: true });
    }
  });

  it('returns no session suggestions when channel defaults have no entry for the requested agent', async () => {
    const openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-agent-defaults-'));
    getOpenClawConfigDir.mockReturnValue(openclawConfigDir);

    const sessionsDir = join(openclawConfigDir, 'agents', 'agent-sales', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(openclawConfigDir, 'channel-defaults.json'), JSON.stringify({
      main: {
        wecom: { to: 'T48250041A' },
      },
    }), 'utf-8');
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      'agent:agent-sales:wecom:direct:sales': {
        sessionId: 'history-session',
        deliveryContext: { channel: 'wecom', to: 'SHOULD_NOT_USE', accountId: 'bot-a' },
      },
    }), 'utf-8');

    const { handleAgentRoutes } = await import('@electron/api/routes/agents');
    const res = {} as never;

    try {
      const handled = await handleAgentRoutes(
        { method: 'GET' } as never,
        res,
        new URL('http://127.0.0.1/api/agents/agent-sales/sessions'),
        {
          gatewayManager: {
            getStatus: () => ({ state: 'stopped' }),
            debouncedReload: vi.fn(),
          },
        } as never,
      );

      expect(handled).toBe(true);
      expect(sendJson).toHaveBeenCalledWith(res, 200, {
        success: true,
        sessions: [],
      });
    } finally {
      rmSync(openclawConfigDir, { recursive: true, force: true });
    }
  });

  it('maps legacy channel-level defaults to the default account', async () => {
    const openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-agent-legacy-defaults-'));
    getOpenClawConfigDir.mockReturnValue(openclawConfigDir);

    writeFileSync(join(openclawConfigDir, 'channel-defaults.json'), JSON.stringify({
      main: {
        wecom: { to: 'T48250041A' },
      },
    }), 'utf-8');

    const { handleAgentRoutes } = await import('@electron/api/routes/agents');
    const res = {} as never;

    try {
      const handled = await handleAgentRoutes(
        { method: 'GET' } as never,
        res,
        new URL('http://127.0.0.1/api/agents/main/sessions'),
        {
          gatewayManager: {
            getStatus: () => ({ state: 'stopped' }),
            debouncedReload: vi.fn(),
          },
        } as never,
      );

      expect(handled).toBe(true);
      expect(sendJson).toHaveBeenCalledWith(res, 200, {
        success: true,
        sessions: [{
          sessionKey: 'agent:main:wecom:default',
          label: 'T48250041A',
          channel: 'wecom',
          to: 'T48250041A',
          accountId: 'default',
          chatType: 'direct',
        }],
      });
    } finally {
      rmSync(openclawConfigDir, { recursive: true, force: true });
    }
  });

  it('rejects path-like agent ids on the sessions route', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');
    const res = {} as never;

    const handled = await handleAgentRoutes(
      { method: 'GET' } as never,
      res,
      new URL('http://127.0.0.1/api/agents/..%2Fsecret/sessions'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledWith(res, 400, {
      success: false,
      error: 'Invalid agent ID',
      code: 'INVALID_AGENT_ID',
    });
    expect(getOpenClawConfigDir).not.toHaveBeenCalled();
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
