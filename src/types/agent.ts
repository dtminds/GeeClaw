export type AgentSkillScope =
  | { mode: 'default' }
  | { mode: 'specified'; skills: string[] };

export type AgentPresetPlatform = 'darwin' | 'win32' | 'linux';

export interface AgentPresetMissingRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
}

export interface AgentPresetSummary {
  presetId: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  managed: boolean;
  agentId: string;
  skillScope: AgentSkillScope;
  presetSkills: string[];
  managedFiles: string[];
  platforms?: AgentPresetPlatform[];
  installable: boolean;
  missingRequirements?: AgentPresetMissingRequirements;
  supportedOnCurrentPlatform: boolean;
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
  managed: boolean;
  presetId?: string;
  lockedFields: string[];
  canUnmanage: boolean;
  managedFiles: string[];
  skillScope: AgentSkillScope;
  presetSkills: string[];
  canUseDefaultSkillScope: boolean;
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  explicitChannelAccountBindings: Record<string, string>;
}
