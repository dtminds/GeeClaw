import type { AgentAvatarPresetId, AgentAvatarSource } from '@/lib/agent-avatar-presets';

export type AgentSkillScope =
  | { mode: 'default' }
  | { mode: 'specified'; skills: string[] };

export type AgentPresetPlatform = 'darwin' | 'win32' | 'linux';
export type ManagedAgentSource = 'preset' | 'marketplace';

export interface AgentPresetMissingRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
}

export interface AgentMarketplaceCompletion {
  operation: 'install' | 'update';
  agentId: string;
  promptText?: string;
}

export interface AgentPresetSummary {
  source: ManagedAgentSource;
  name: string;
  description: string;
  emoji: string;
  category: string;
  managed: boolean;
  agentId: string;
  latestVersion?: string;
  installed: boolean;
  installedVersion?: string;
  hasUpdate: boolean;
  skillScope: AgentSkillScope;
  presetSkills: string[];
  managedFiles: string[];
  minAppVersion?: string;
  platforms?: AgentPresetPlatform[];
  installable: boolean;
  missingRequirements?: AgentPresetMissingRequirements;
  supportedOnCurrentPlatform: boolean;
  supportedOnCurrentAppVersion: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
  channelAccounts: Array<{ channelType: string; accountId: string }>;
  source: 'custom' | 'preset';
  managementSource?: ManagedAgentSource;
  managed: boolean;
  presetId?: string;
  packageVersion?: string;
  lockedFields: string[];
  canUnmanage: boolean;
  managedFiles: string[];
  skillScope: AgentSkillScope;
  manualSkills?: string[];
  deniedTools?: string[];
  presetSkills: string[];
  canUseDefaultSkillScope: boolean;
  avatarPresetId: AgentAvatarPresetId;
  avatarSource: AgentAvatarSource;
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  explicitChannelAccountBindings: Record<string, string>;
}
