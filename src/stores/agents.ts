import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { invalidatePresetAgentSkillsCache } from '@/pages/Chat/slash-picker';
import type { AgentAvatarPresetId } from '@/lib/agent-avatar-presets';
import { useGatewayStore } from '@/stores/gateway';
import type { ChannelType } from '@/types/channel';
import type {
  AgentMarketplaceCompletion,
  AgentPresetSummary,
  AgentSkillScope,
  AgentSummary,
  AgentsSnapshot,
} from '@/types/agent';
import type { GatewayStatus } from '@/types/gateway';

export const PRESET_INSTALL_STAGE_VISIBLE_MS = 120;
export const PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS = 3200;
export const PRESET_INSTALL_GATEWAY_RECOVERY_TIMEOUT_MS = 15000;

export type PresetInstallStage =
  | 'idle'
  | 'preparing'
  | 'installing_files'
  | 'installing_skills'
  | 'finalizing'
  | 'completed'
  | 'failed';

interface AgentsState {
  agents: AgentSummary[];
  presets: AgentPresetSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  explicitChannelAccountBindings: Record<string, string>;
  installingPresetId: string | null;
  installStage: PresetInstallStage;
  installProgress: number;
  marketplaceCompletion: AgentMarketplaceCompletion | null;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  fetchPresets: () => Promise<void>;
  createAgent: (name: string, id: string, avatarPresetId?: AgentAvatarPresetId) => Promise<void>;
  updateAgent: (agentId: string, name: string) => Promise<void>;
  updateAgentSettings: (
    agentId: string,
    updates: {
      name?: string;
      skillScope?: AgentSkillScope;
      manualSkills?: string[];
      avatarPresetId?: AgentAvatarPresetId;
      activeMemoryEnabled?: boolean;
      activeEvolutionEnabled?: boolean;
    },
  ) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  installMarketplaceAgent: (agentId: string) => Promise<void>;
  updateMarketplaceAgent: (agentId: string) => Promise<void>;
  unmanageAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  clearError: () => void;
  clearMarketplaceCompletion: () => void;
}

function resolveSnapshotError(snapshot: unknown, fallbackMessage: string): Error {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const error = (snapshot as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) {
      return new Error(error);
    }
  }

  return new Error(fallbackMessage);
}

function requireAgentsSnapshot(snapshot: AgentsSnapshot | undefined, context: string): AgentsSnapshot {
  if (
    snapshot
    && Array.isArray(snapshot.agents)
    && typeof snapshot.defaultAgentId === 'string'
    && Array.isArray(snapshot.configuredChannelTypes)
    && snapshot.channelOwners
    && typeof snapshot.channelOwners === 'object'
    && snapshot.channelAccountOwners
    && typeof snapshot.channelAccountOwners === 'object'
    && snapshot.explicitChannelAccountBindings
    && typeof snapshot.explicitChannelAccountBindings === 'object'
  ) {
    return snapshot;
  }

  throw resolveSnapshotError(snapshot, `[agentsStore] ${context} returned an invalid agent snapshot`);
}

function applySnapshot(snapshot: AgentsSnapshot | undefined, context: string) {
  const validSnapshot = requireAgentsSnapshot(snapshot, context);

  return {
    agents: validSnapshot.agents,
    defaultAgentId: validSnapshot.defaultAgentId,
    configuredChannelTypes: validSnapshot.configuredChannelTypes,
    channelOwners: validSnapshot.channelOwners,
    channelAccountOwners: validSnapshot.channelAccountOwners,
    explicitChannelAccountBindings: validSnapshot.explicitChannelAccountBindings,
  };
}

function applyMarketplacePresetMutation(
  presets: AgentPresetSummary[],
  snapshot: AgentsSnapshot | undefined,
  agentId: string,
) {
  const validSnapshot = requireAgentsSnapshot(snapshot, 'Marketplace mutation');
  const installedAgent = validSnapshot.agents.find((agent) => agent.id === agentId);
  const installedVersion = installedAgent?.packageVersion;

  return presets.map((preset) => {
    if (preset.agentId !== agentId) {
      return preset;
    }

    return {
      ...preset,
      installed: true,
      installedVersion: installedVersion ?? preset.latestVersion ?? preset.installedVersion,
      hasUpdate: false,
    };
  });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function waitForPresetInstallGatewayRecovery(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let sawNonRunning = useGatewayStore.getState().status.state !== 'running';
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (unsubscribe: () => void) => {
      unsubscribe();
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    };

    const finishResolve = (unsubscribe: () => void) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup(unsubscribe);
      resolve();
    };

    const finishReject = (unsubscribe: () => void, error: Error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup(unsubscribe);
      reject(error);
    };

    const evaluate = (state: GatewayStatus['state'], unsubscribe: () => void) => {
      if (state === 'error') {
        finishReject(unsubscribe, new Error('Gateway failed to recover after preset install'));
        return;
      }
      if (state !== 'running') {
        sawNonRunning = true;
        return;
      }
      if (sawNonRunning) {
        finishResolve(unsubscribe);
      }
    };

    const unsubscribe = useGatewayStore.subscribe((gatewayState) => {
      evaluate(gatewayState.status.state, unsubscribe);
    });

    settleTimer = globalThis.setTimeout(() => {
      if (finished) {
        return;
      }
      const state = useGatewayStore.getState().status.state;
      if (!sawNonRunning && state === 'running') {
        finishResolve(unsubscribe);
        return;
      }
      evaluate(state, unsubscribe);
    }, PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS);

    timeoutTimer = globalThis.setTimeout(() => {
      if (finished) {
        return;
      }
      const state = useGatewayStore.getState().status.state;
      if (state === 'running') {
        finishResolve(unsubscribe);
        return;
      }
      finishReject(unsubscribe, new Error('Gateway reload timed out after preset install'));
    }, PRESET_INSTALL_GATEWAY_RECOVERY_TIMEOUT_MS);

    evaluate(useGatewayStore.getState().status.state, unsubscribe);
  });
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  presets: [],
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

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents');
      set({
        ...applySnapshot(snapshot, 'Fetching agents'),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  fetchPresets: async () => {
    set({ error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; presets: AgentPresetSummary[] }>('/api/agents/presets');
      set({ presets: result.presets });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  createAgent: async (name: string, id: string, avatarPresetId?: AgentAvatarPresetId) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name, id, avatarPresetId }),
      });
      set(applySnapshot(snapshot, 'Creating agent'));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, name: string) => {
    await get().updateAgentSettings(agentId, { name });
  },

  updateAgentSettings: async (
    agentId: string,
    updates: {
      name?: string;
      skillScope?: AgentSkillScope;
      manualSkills?: string[];
      avatarPresetId?: AgentAvatarPresetId;
      activeMemoryEnabled?: boolean;
      activeEvolutionEnabled?: boolean;
    },
  ) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(updates),
        }
      );
      set(applySnapshot(snapshot, 'Updating agent settings'));
      invalidatePresetAgentSkillsCache();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  installMarketplaceAgent: async (agentId: string) => {
    const installTargetId = agentId;
    set({
      error: null,
      marketplaceCompletion: null,
      installingPresetId: installTargetId,
      installStage: 'preparing',
      installProgress: 10,
    });
    const advanceStage = (stage: PresetInstallStage, progress: number) => {
      if (get().installingPresetId !== installTargetId) {
        return;
      }
      set({ installStage: stage, installProgress: progress });
    };
    try {
      const installRequest = hostApiFetch<AgentsSnapshot & {
        success?: boolean;
        completion?: AgentMarketplaceCompletion;
      }>(
        '/api/agents/marketplace/install',
        {
          method: 'POST',
          body: JSON.stringify({ agentId }),
        }
      );
      await wait(PRESET_INSTALL_STAGE_VISIBLE_MS);
      advanceStage('installing_files', 35);
      await wait(PRESET_INSTALL_STAGE_VISIBLE_MS);
      advanceStage('installing_skills', 70);
      const [snapshot] = await Promise.all([
        installRequest,
        wait(PRESET_INSTALL_STAGE_VISIBLE_MS),
      ]);
      advanceStage('finalizing', 90);
      await wait(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await waitForPresetInstallGatewayRecovery();
      const nextPresets = applyMarketplacePresetMutation(get().presets, snapshot, agentId);
      if (get().installingPresetId === installTargetId) {
        set({
          ...applySnapshot(snapshot, 'Installing marketplace agent'),
          presets: nextPresets,
          marketplaceCompletion: snapshot.completion ?? null,
          installStage: 'completed',
          installProgress: 100,
        });
      } else {
        set({
          ...applySnapshot(snapshot, 'Installing marketplace agent'),
          presets: nextPresets,
          marketplaceCompletion: snapshot.completion ?? null,
        });
      }
      invalidatePresetAgentSkillsCache();
    } catch (error) {
      if (get().installingPresetId === installTargetId) {
        set({ installStage: 'failed', error: String(error) });
      } else {
        set({ error: String(error) });
      }
      throw error;
    } finally {
      globalThis.setTimeout(() => {
        if (get().installingPresetId === installTargetId) {
          set({
            installingPresetId: null,
            installStage: 'idle',
            installProgress: 0,
          });
        }
      }, 600);
    }
  },

  updateMarketplaceAgent: async (agentId: string) => {
    const installTargetId = agentId;
    set({
      error: null,
      marketplaceCompletion: null,
      installingPresetId: installTargetId,
      installStage: 'preparing',
      installProgress: 10,
    });
    const advanceStage = (stage: PresetInstallStage, progress: number) => {
      if (get().installingPresetId !== installTargetId) {
        return;
      }
      set({ installStage: stage, installProgress: progress });
    };

    try {
      const updateRequest = hostApiFetch<AgentsSnapshot & {
        success?: boolean;
        completion?: AgentMarketplaceCompletion;
      }>(
        '/api/agents/marketplace/update',
        {
          method: 'POST',
          body: JSON.stringify({ agentId }),
        }
      );
      await wait(PRESET_INSTALL_STAGE_VISIBLE_MS);
      advanceStage('installing_files', 35);
      await wait(PRESET_INSTALL_STAGE_VISIBLE_MS);
      advanceStage('installing_skills', 70);
      const [snapshot] = await Promise.all([
        updateRequest,
        wait(PRESET_INSTALL_STAGE_VISIBLE_MS),
      ]);
      advanceStage('finalizing', 90);
      await wait(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await waitForPresetInstallGatewayRecovery();
      const nextPresets = applyMarketplacePresetMutation(get().presets, snapshot, agentId);
      if (get().installingPresetId === installTargetId) {
        set({
          ...applySnapshot(snapshot, 'Updating marketplace agent'),
          presets: nextPresets,
          marketplaceCompletion: snapshot.completion ?? null,
          installStage: 'completed',
          installProgress: 100,
        });
      } else {
        set({
          ...applySnapshot(snapshot, 'Updating marketplace agent'),
          presets: nextPresets,
          marketplaceCompletion: snapshot.completion ?? null,
        });
      }
      invalidatePresetAgentSkillsCache();
    } catch (error) {
      if (get().installingPresetId === installTargetId) {
        set({ installStage: 'failed', error: String(error) });
      } else {
        set({ error: String(error) });
      }
      throw error;
    } finally {
      globalThis.setTimeout(() => {
        if (get().installingPresetId === installTargetId) {
          set({
            installingPresetId: null,
            installStage: 'idle',
            installProgress: 0,
          });
        }
      }, 600);
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        { method: 'DELETE' }
      );
      set(applySnapshot(snapshot, 'Deleting agent'));
      invalidatePresetAgentSkillsCache();
      try {
        const { useChatStore } = await import('./chat');
        await useChatStore.getState().handleAgentDeleted(agentId);
      } catch (error) {
        console.warn('[agentsStore] Failed to sync deleted agent with chat store:', error);
        set({ error: String(error) });
        throw error;
      }
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  unmanageAgent: async (agentId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/unmanage`,
        { method: 'POST' }
      );
      set(applySnapshot(snapshot, 'Unmanaging agent'));
      invalidatePresetAgentSkillsCache();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  assignChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'PUT' }
      );
      set(applySnapshot(snapshot, 'Assigning channel'));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'DELETE' }
      );
      set(applySnapshot(snapshot, 'Removing channel'));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
  clearMarketplaceCompletion: () => set({ marketplaceCompletion: null }),
}));
