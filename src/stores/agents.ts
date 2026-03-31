import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { ChannelType } from '@/types/channel';
import type { AgentPresetSummary, AgentSkillScope, AgentSummary, AgentsSnapshot } from '@/types/agent';

export const PRESET_INSTALL_STAGE_VISIBLE_MS = 120;

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
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  fetchPresets: () => Promise<void>;
  createAgent: (name: string, id: string) => Promise<void>;
  updateAgent: (agentId: string, name: string) => Promise<void>;
  updateAgentSettings: (agentId: string, updates: { name?: string; skillScope?: AgentSkillScope }) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  installPreset: (presetId: string) => Promise<void>;
  unmanageAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  clearError: () => void;
}

function applySnapshot(snapshot: AgentsSnapshot | undefined) {
  return snapshot ? {
    agents: snapshot.agents,
    defaultAgentId: snapshot.defaultAgentId,
    configuredChannelTypes: snapshot.configuredChannelTypes,
    channelOwners: snapshot.channelOwners,
    channelAccountOwners: snapshot.channelAccountOwners,
    explicitChannelAccountBindings: snapshot.explicitChannelAccountBindings,
  } : {};
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
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
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents');
      set({
        ...applySnapshot(snapshot),
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

  createAgent: async (name: string, id: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name, id }),
      });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, name: string) => {
    await get().updateAgentSettings(agentId, { name });
  },

  updateAgentSettings: async (agentId: string, updates: { name?: string; skillScope?: AgentSkillScope }) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(updates),
        }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  installPreset: async (presetId: string) => {
    set({
      error: null,
      installingPresetId: presetId,
      installStage: 'preparing',
      installProgress: 10,
    });
    const advanceStage = (stage: PresetInstallStage, progress: number) => {
      if (get().installingPresetId !== presetId) {
        return;
      }
      set({ installStage: stage, installProgress: progress });
    };
    try {
      const installRequest = hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        '/api/agents/presets/install',
        {
          method: 'POST',
          body: JSON.stringify({ presetId }),
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
      if (get().installingPresetId === presetId) {
        set({
          ...applySnapshot(snapshot),
          installStage: 'completed',
          installProgress: 100,
        });
      } else {
        set(applySnapshot(snapshot));
      }
    } catch (error) {
      if (get().installingPresetId === presetId) {
        set({ installStage: 'failed', error: String(error) });
      } else {
        set({ error: String(error) });
      }
      throw error;
    } finally {
      globalThis.setTimeout(() => {
        if (get().installingPresetId === presetId) {
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
      set(applySnapshot(snapshot));
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
      set(applySnapshot(snapshot));
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
      set(applySnapshot(snapshot));
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
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
