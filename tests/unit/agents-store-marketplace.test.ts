import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS,
  PRESET_INSTALL_STAGE_VISIBLE_MS,
  useAgentsStore,
} from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';

const hostApiFetchMock = vi.fn();
const invalidatePresetAgentSkillsCacheMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/pages/Chat/slash-picker', () => ({
  invalidatePresetAgentSkillsCache: () => invalidatePresetAgentSkillsCacheMock(),
}));

function resetAgentsStore() {
  useAgentsStore.setState({
    agents: [],
    presets: [{
      source: 'marketplace',
      name: 'Alpha Agent',
      description: 'desc',
      emoji: '🤖',
      category: 'test',
      managed: true,
      agentId: 'alpha-agent',
      latestVersion: '1.0.0',
      installed: false,
      hasUpdate: false,
      skillScope: { mode: 'default' },
      presetSkills: [],
      managedFiles: [],
      installable: true,
      supportedOnCurrentPlatform: true,
      supportedOnCurrentAppVersion: true,
    }],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
    installingPresetId: null,
    installStage: 'idle',
    installProgress: 0,
    marketplaceCompletion: null,
    loading: false,
    error: null,
  });
}

function resetGatewayStore() {
  useGatewayStore.setState({
    ...useGatewayStore.getState(),
    status: {
      state: 'running',
      port: 28788,
    },
    health: null,
    isInitialized: true,
    lastError: null,
  });
}

async function advanceInstallTimers() {
  for (const step of [
    PRESET_INSTALL_STAGE_VISIBLE_MS,
    PRESET_INSTALL_STAGE_VISIBLE_MS,
    PRESET_INSTALL_STAGE_VISIBLE_MS,
    PRESET_INSTALL_STAGE_VISIBLE_MS,
    PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS,
  ]) {
    await vi.advanceTimersByTimeAsync(step);
  }
}

describe('agents store marketplace install', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetAgentsStore();
    resetGatewayStore();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it('treats invalid marketplace preset responses as an empty catalog', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      success: false,
      error: 'catalog unavailable',
    });

    await expect(useAgentsStore.getState().fetchPresets()).resolves.toBeUndefined();

    expect(useAgentsStore.getState().presets).toEqual([]);
    expect(useAgentsStore.getState().error).toBeNull();
  });

  it('does not clear an existing agent error while refreshing marketplace presets', async () => {
    useAgentsStore.setState({ error: 'Error: agent snapshot failed' });
    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      presets: [],
    });

    await useAgentsStore.getState().fetchPresets();

    expect(useAgentsStore.getState().presets).toEqual([]);
    expect(useAgentsStore.getState().error).toBe('Error: agent snapshot failed');
  });

  it('surfaces invalid marketplace install responses instead of crashing on missing snapshot fields', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      success: false,
      error: 'install failed',
    });

    const installPromise = useAgentsStore.getState().installMarketplaceAgent('alpha-agent');
    const installErrorPromise = installPromise.then(
      () => null,
      (error) => error,
    );
    await advanceInstallTimers();

    await expect(installErrorPromise).resolves.toMatchObject({
      message: 'install failed',
    });
    expect(useAgentsStore.getState().error).toContain('install failed');
    expect(useAgentsStore.getState().marketplaceCompletion).toBeNull();
  });
});
